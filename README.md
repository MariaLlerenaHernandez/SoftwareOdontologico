# SIGO-Dental · Sistema Integral de Gestión Odontológica

Sistema web para clínicas odontológicas: **expediente clínico digital**, odontograma interactivo, periodontograma, agenda por sillón, presupuestos, facturación electrónica, caja, honorarios, inventario, reportes y auditoría. Lo construimos a partir del documento de requerimientos **SRS/BRD SIGO-Dental v1.0**.

| Capa | Tecnología |
|---|---|
| Frontend | React 19 · TypeScript · Vite · Tailwind CSS 4 · Recharts · Lucide |
| Backend | Go 1.27 (`net/http`), API REST, JWT, bcrypt, TOTP, AES-256-GCM |
| Base de datos | PostgreSQL 16 (restricciones y triggers para las reglas de negocio) |
| Infraestructura | Docker Compose (db + api + web/nginx) |
| Documentación API | OpenAPI 3.0 / Swagger UI en `/api/docs` |

```
┌──────────────── Cliente ────────────────┐
│ React + Tailwind (SPA responsive)       │
└───────────────┬─────────────────────────┘
                │ HTTPS · JWT Bearer
┌───────────────▼─────────────────────────┐
│ nginx (reverse proxy /api)              │
└───────────────┬─────────────────────────┘
┌───────────────▼─────────────────────────┐
│ API Go modular                          │
│  · Clínico y agenda  · Facturación/stock│
│  · RBAC + MFA + auditoría (middleware)  │
│  · Worker de recordatorios 48h/24h      │
└───────────────┬─────────────────────────┘
┌───────────────▼─────────────────────────┐
│ PostgreSQL  ·  Archivos cifrados (AES)  │
└─────────────────────────────────────────┘
```

---

## 1. Puesta en marcha

### Opción A — Todo con Docker (recomendada)

Requisito: Docker Desktop.

```bash
docker compose up --build
```

- Aplicación: **http://localhost:8081**
- API y Swagger: **http://localhost:8080/api/docs**

En el primer arranque la API crea el esquema y carga los datos de demostración: 12 pacientes, 60 días de historial de citas, facturas y caja, planes, notas y recetas.

### Opción B — Modo desarrollo

Requisitos: Go 1.22+, Node 20+, Docker (solo para PostgreSQL).

```bash
docker compose up -d db
```

```bash
cd backend && go run .
```

```bash
cd frontend && npm install && npm run dev
```

Abra **http://localhost:5173**. Vite redirige `/api` hacia `localhost:8080`.

### Reiniciar los datos de demostración

```bash
docker compose down -v
```

### Cuentas de demostración

Todas usan la contraseña **`Sigo2026!`**

| Rol | Correo | Qué puede probar |
|---|---|---|
| Administrador TI | `admin@sigodental.com` | Usuarios, catálogos, configuración, auditoría, respaldo |
| Recepción / Caja | `recepcion@sigodental.com` | Pacientes, agenda, aprobación de presupuestos, facturación, caja ciega |
| Odontóloga | `dra.torres@sigodental.com` | Odontograma, periodontograma, notas SOEP, planes, recetas |
| Odontólogo | `dr.ramirez@sigodental.com` | Endodoncia y cirugía |
| Odontóloga | `dra.castillo@sigodental.com` | Ortodoncia y odontopediatría |
| Asistente dental | `asistente@sigodental.com` | Signos vitales, notas, inventario |
| Auditor / Contador | `auditor@sigodental.com` | Reportes, cierres de caja, honorarios, auditoría |

---

## 2. Guion de demostración sugerido

1. **Recepción**: abra *Caja* y luego *Abrir caja*. En *Agenda*, haga clic en un espacio libre de un sillón y agende una cita. Intente agendar otra cita en el mismo sillón y horario: el sistema la rechaza (**RN-03**).
2. **Odontóloga** (`dra.torres`): abra *Pacientes* y luego *María José Andrade*. Se ve el **badge rojo de alergia a penicilina**. En *Odontograma*, elija una herramienta (caries, corona, exodoncia…) y haga clic sobre una superficie. Puede cambiar entre FDI y Universal y entre dentición permanente, mixta y temporal.
3. En *Evolución SOEP*, cree una nota y fírmela con su contraseña. Ya no se puede editar; las correcciones se registran como **adenda** (**RN-01**).
4. En *Recetas*, recete *Amoxicilina*: el sistema alerta del conflicto con la alergia.
5. En *Planes y presupuestos*, cree un plan por fases y preséntelo. Después, como recepción, registre la **aprobación parcial**.
6. Como odontóloga, marque un ítem como *Realizado*. Se actualiza el odontograma y se **descuentan los insumos** de la receta estándar (*Inventario*, pestaña *Kardex*).
7. **Recepción**: en *Facturación*, cree una *Nueva factura*. El procedimiento realizado se carga solo. Registre un pago mixto (efectivo + tarjeta).
8. En *Caja*, haga el *Cierre ciego*: se declara el conteo y **solo después** se muestran el total teórico y la diferencia (**RN-02**).
9. **Auditor**: revise *Honorarios* (liquidación por profesional), *Reportes* y *Auditoría*.
10. **Cualquier usuario**: en *Mi perfil*, active MFA escaneando el QR con Google Authenticator. Como admin puede volver obligatorio el MFA en *Configuración*.

---

## 3. Matriz de trazabilidad de requerimientos

### Requerimientos funcionales

| ID | Requerimiento | Implementación |
|---|---|---|
| RF-01 | Ficha única del paciente | `PatientForm`, `POST/PUT /patients`. Tutor legal obligatorio para menores, seguro/convenio y contacto de emergencia |
| RF-02 | Anamnesis y alertas | `HistoryTab`, `/patients/{id}/history`. Badge rojo en la cabecera del expediente y en agenda y listados |
| RF-03 | Odontograma interactivo | `Odontogram.tsx` (SVG). 32 piezas permanentes y 20 temporales, FDI y Universal, 5 superficies, 12 condiciones con colores estándar |
| RF-04 | Periodontograma | `PerioTab`. 6 sitios por diente: PS, MG, **NIC = PS + MG**, sangrado, furca, movilidad, resumen y diagnóstico orientativo |
| RF-05 | Notas SOEP inmutables | Bloqueo configurable (24 h por defecto), firma digital (re-autenticación + SHA-256) y adendas. Lo hace cumplir un trigger en la BD |
| RF-06 | Consentimiento informado | Plantillas por procedimiento. Firma manuscrita en pantalla o tablet (canvas) **u** OTP de 6 dígitos con vencimiento de 10 min |
| RF-07 | Presupuestos multinivel | Fases, honorarios, costo de laboratorio, descuentos por ítem y globales. Tope de descuento sin autorización del admin |
| RF-08 | Aprobación → citas | Aprobación total o parcial y agendamiento de ítems aprobados. Al cancelar la cita, el ítem se libera |
| RF-09 | Agenda multirrecinto | Vista de día por sillón y vista de semana, con filtros por sede y profesional |
| RF-10 | Estados de cita | Los 7 estados del SRS, con máquina de transiciones válidas y trazabilidad |
| RF-11 | Notificaciones | Confirmación al agendar y worker de recordatorios **48 h / 24 h** por WhatsApp, SMS o email según la preferencia del paciente |
| RF-12 | Facturación electrónica | Numeración `001-001-#########`, clave de acceso de 49 dígitos con módulo 11, pagos mixtos, abonos y anulación |
| RF-13 | Honorarios | Reglas `porcentaje`, `fijo` y `porcentaje_neto` (tras laboratorio y materiales). La regla por procedimiento prevalece. Liquidaciones sin solapamiento |
| RF-14 | Descargo de insumos | Receta estándar por procedimiento. Descuento automático al marcar *realizado* y kardex por sede y profesional |

### Reglas de negocio

| ID | Regla | Cómo se garantiza |
|---|---|---|
| RN-01 | Lo realizado no se borra | Triggers `fn_protect_done` y `fn_protect_notes` en PostgreSQL. Las recetas son inmutables y las correcciones van por adenda |
| RN-02 | Cierre de caja ciego | `GET /cash/current` nunca devuelve el teórico; se calcula y revela en `POST /cash/close` |
| RN-03 | Sin choques de sillón | Restricción `EXCLUDE USING gist (chair_id WITH =, tstzrange(...) WITH &&)` en la tabla `appointments` |

### Requerimientos no funcionales

| ID | Requerimiento | Implementación |
|---|---|---|
| RNF-01 | Rendimiento | Carga diferida por ruta, índices en BD, odontograma SVG sin dependencias |
| RNF-03 | Concurrencia | Pool de 25 conexiones, servidor HTTP concurrente de Go y transacciones con `FOR UPDATE` |
| RNF-04 | Cifrado | Archivos clínicos cifrados con **AES-256-GCM** en reposo; TLS se configura en el proxy de producción |
| RNF-05 | Autenticación | RBAC por endpoint, **MFA TOTP** (RFC 6238) que puede volverse obligatorio, cierre de sesión a los 15 min de inactividad, bloqueo tras 5 intentos fallidos y política de contraseñas |
| RNF-06 | Auditoría | Tabla `audit_log` inmutable (trigger). Registra CRUD, lecturas de expedientes, exportaciones, accesos denegados y logins, con IP y marca de tiempo ISO-8601 |
| RNF-07/08 | Responsive y navegadores | Tailwind con layout adaptable a escritorio, laptop y tablet; navegadores modernos |

---

## 4. Pruebas

```bash
cd backend && go test -cover ./...
```

Pruebas de integración contra PostgreSQL real. **Borran la base indicada**, así que use una base de pruebas:

```bash
docker exec sigo-dental-db psql -U sigo -d postgres -c "CREATE DATABASE sigo_test"
```

```bash
cd backend && TEST_DATABASE_URL="postgres://sigo:sigo_dental_2026@localhost:5435/sigo_test?sslmode=disable" go test -cover ./...
```

| Paquete | Cobertura |
|---|---|
| `internal/domain` (reglas de negocio) | 88.6 % |
| `internal/security` (JWT, TOTP RFC 6238, AES-GCM, bcrypt) | 83.3 % |
| `internal/api` (integración de endpoints) | 64.6 % |

Las pruebas de integración recorren: RBAC, alta de pacientes, odontograma, periodontograma, RN-03, transiciones de cita, aprobación parcial, descargo de inventario, RN-01, caja ciega, factura con abonos, anulación, honorarios, firma de notas, adendas, alergias en recetas, OTP de consentimientos, política de contraseñas, reportes y auditoría.

---

## 5. Estructura del proyecto

```
SistemaOdontologico/
├── docker-compose.yml
├── backend/
│   ├── main.go                      # configuración, migración, servidor y worker
│   └── internal/
│       ├── api/                     # handlers REST por módulo + RBAC/auditoría
│       │   ├── server.go            # contexto, middleware, errores, auditoría
│       │   ├── routes.go            # rutas con roles permitidos
│       │   ├── patients.go clinical.go plans.go agenda.go
│       │   ├── billing.go inventory.go reports.go admin.go auth.go
│       │   └── openapi.yaml         # especificación OpenAPI 3.0
│       ├── domain/                  # reglas puras + pruebas unitarias
│       ├── security/                # bcrypt, JWT, TOTP, AES-256-GCM
│       └── db/sql/                  # 01_schema.sql · 02_seed.sql
└── frontend/
    └── src/
        ├── components/              # UI kit, Odontogram, SignaturePad, formularios
        ├── pages/                   # módulos (agenda, facturación, caja…)
        │   └── patient/             # pestañas del expediente clínico
        └── lib/                     # cliente API, auth, nomenclatura dental
```

---

## 6. Integraciones externas (alcance académico)

Según la sección 7.1 del SRS, estas integraciones quedan **simuladas** tras interfaces intercambiables:

- **Mensajería** (Meta Cloud API / Twilio): el `Notifier` registra cada mensaje en *Notificaciones*. Basta con implementar la interfaz `Notifier` para usar un proveedor real.
- **Autoridad tributaria**: se genera la clave de acceso válida (módulo 11) y el estado *autorizada* en ambiente de pruebas.
- **Pasarela de pagos**: los pagos con tarjeta o transferencia registran el número de autorización.
- **PACS/DICOM**: los `.dcm` se almacenan y descargan cifrados. La visualización 3D queda para la Fase 2, como indica el SRS.

> **Producción**: defina `JWT_SECRET` y `FILE_ENCRYPTION_KEY` (ver `.env.example`), active TLS 1.3 en el proxy y cifrado en reposo del volumen de la BD, y cambie las contraseñas de demostración.
