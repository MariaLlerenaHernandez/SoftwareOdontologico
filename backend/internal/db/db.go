// Package db encapsula el acceso a PostgreSQL: conexión, migración inicial
// y utilidades para devolver filas como mapas listos para serializar a JSON.
package db

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed sql/01_schema.sql
var schemaSQL string

//go:embed sql/02_seed.sql
var seedSQL string

// ErrNotFound se devuelve cuando una consulta de una sola fila no encuentra resultados.
var ErrNotFound = errors.New("registro no encontrado")

// Querier es satisfecho tanto por *pgxpool.Pool como por pgx.Tx.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Connect abre el pool de conexiones fijando la zona horaria de la clínica.
func Connect(ctx context.Context, url, timezone string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL inválida: %w", err)
	}
	cfg.ConnConfig.RuntimeParams["timezone"] = timezone
	cfg.MaxConns = 25

	var pool *pgxpool.Pool
	for attempt := 1; attempt <= 15; attempt++ {
		pool, err = pgxpool.NewWithConfig(ctx, cfg)
		if err == nil {
			if err = pool.Ping(ctx); err == nil {
				return pool, nil
			}
			pool.Close()
		}
		time.Sleep(2 * time.Second)
	}
	return nil, fmt.Errorf("no se pudo conectar a PostgreSQL: %w", err)
}

// Migrate crea el esquema y los datos de demostración si la base está vacía.
// seedUsers se ejecuta entre el esquema y el resto de datos para que las
// contraseñas se generen con bcrypt desde Go.
func Migrate(ctx context.Context, pool *pgxpool.Pool, seedUsers func(ctx context.Context, tx pgx.Tx) error) (bool, error) {
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT to_regclass('public.users') IS NOT NULL`).Scan(&exists); err != nil {
		return false, err
	}
	if exists {
		return false, nil
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, schemaSQL); err != nil {
		return false, fmt.Errorf("esquema: %w", err)
	}
	if err := seedUsers(ctx, tx); err != nil {
		return false, fmt.Errorf("usuarios: %w", err)
	}
	if _, err := tx.Exec(ctx, seedSQL); err != nil {
		return false, fmt.Errorf("datos de demostración: %w", err)
	}
	return true, tx.Commit(ctx)
}

// Rows ejecuta la consulta y devuelve todas las filas como mapas.
func Rows(ctx context.Context, q Querier, sql string, args ...any) ([]map[string]any, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	fields := rows.FieldDescriptions()
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		m := make(map[string]any, len(vals))
		for i, v := range vals {
			m[fields[i].Name] = normalize(fields[i].DataTypeOID, v)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Row devuelve una única fila o ErrNotFound.
func Row(ctx context.Context, q Querier, sql string, args ...any) (map[string]any, error) {
	rows, err := Rows(ctx, q, sql, args...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	return rows[0], nil
}

// normalize convierte los tipos de pgx a valores JSON amigables.
func normalize(oid uint32, v any) any {
	switch val := v.(type) {
	case pgtype.Numeric:
		if !val.Valid {
			return nil
		}
		f, err := val.Float64Value()
		if err != nil {
			return nil
		}
		return f.Float64
	case time.Time:
		if oid == pgtype.DateOID {
			return val.Format("2006-01-02")
		}
		return val
	case [16]byte:
		return fmt.Sprintf("%x", val)
	}
	return v
}
