// Package security agrupa las primitivas criptográficas del sistema:
// contraseñas (bcrypt), tokens JWT, TOTP para MFA, cifrado AES-256-GCM de
// archivos en reposo y huellas SHA-256 para la firma de notas clínicas.
package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"net/url"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// ---------------------------------------------------------------- contraseñas

func HashPassword(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), 11)
	return string(b), err
}

func CheckPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}

// ValidatePasswordPolicy exige longitud mínima y mezcla de caracteres.
func ValidatePasswordPolicy(pw string) error {
	if len(pw) < 8 {
		return errors.New("la contraseña debe tener al menos 8 caracteres")
	}
	var upper, lower, digit bool
	for _, r := range pw {
		switch {
		case r >= 'A' && r <= 'Z':
			upper = true
		case r >= 'a' && r <= 'z':
			lower = true
		case r >= '0' && r <= '9':
			digit = true
		}
	}
	if !upper || !lower || !digit {
		return errors.New("la contraseña debe incluir mayúsculas, minúsculas y números")
	}
	return nil
}

// ---------------------------------------------------------------------- JWT

type Claims struct {
	UserID int64  `json:"uid"`
	Email  string `json:"email"`
	Name   string `json:"name"`
	Role   string `json:"role"`
	MFA    bool   `json:"mfa"`
	jwt.RegisteredClaims
}

func IssueToken(secret []byte, c Claims, ttl time.Duration) (string, error) {
	now := time.Now()
	c.RegisteredClaims = jwt.RegisteredClaims{
		Issuer:    "sigo-dental",
		Subject:   fmt.Sprint(c.UserID),
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(secret)
}

func ParseToken(secret []byte, token string) (*Claims, error) {
	c := &Claims{}
	_, err := jwt.ParseWithClaims(token, c, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("algoritmo no permitido")
		}
		return secret, nil
	}, jwt.WithIssuer("sigo-dental"))
	if err != nil {
		return nil, err
	}
	return c, nil
}

// --------------------------------------------------------------- TOTP (MFA)

// NewTOTPSecret genera un secreto base32 de 160 bits (RFC 4226).
func NewTOTPSecret() string {
	b := make([]byte, 20)
	_, _ = rand.Read(b)
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b)
}

// TOTPURL construye el URI otpauth:// para apps como Google Authenticator.
func TOTPURL(issuer, account, secret string) string {
	return fmt.Sprintf("otpauth://totp/%s:%s?secret=%s&issuer=%s&algorithm=SHA1&digits=6&period=30",
		url.PathEscape(issuer), url.PathEscape(account), secret, url.QueryEscape(issuer))
}

// TOTPCode calcula el código de 6 dígitos para un instante (RFC 6238).
func TOTPCode(secret string, t time.Time) (string, error) {
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(strings.TrimSpace(secret)))
	if err != nil {
		return "", err
	}
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], uint64(t.Unix()/30))
	mac := hmac.New(sha1.New, key)
	mac.Write(msg[:])
	sum := mac.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	code := (binary.BigEndian.Uint32(sum[off:off+4]) & 0x7fffffff) % 1_000_000
	return fmt.Sprintf("%06d", code), nil
}

// VerifyTOTP acepta el código actual y ±1 ventana de 30 s por desfase de reloj.
func VerifyTOTP(secret, code string) bool {
	code = strings.TrimSpace(code)
	now := time.Now()
	for _, skew := range []time.Duration{0, -30 * time.Second, 30 * time.Second} {
		if c, err := TOTPCode(secret, now.Add(skew)); err == nil && hmac.Equal([]byte(c), []byte(code)) {
			return true
		}
	}
	return false
}

// --------------------------------------------------------- OTP numéricos

// RandomDigits genera un código numérico aleatorio (p. ej. OTP de consentimiento).
func RandomDigits(n int) string {
	var sb strings.Builder
	for i := 0; i < n; i++ {
		d, _ := rand.Int(rand.Reader, big.NewInt(10))
		sb.WriteString(d.String())
	}
	return sb.String()
}

func SHA256Hex(parts ...string) string {
	h := sha256.Sum256([]byte(strings.Join(parts, "|")))
	return hex.EncodeToString(h[:])
}

// --------------------------------------------------- Cifrado AES-256-GCM

type FileCipher struct{ aead cipher.AEAD }

// NewFileCipher deriva una clave de 256 bits a partir de la clave configurada.
func NewFileCipher(key string) (*FileCipher, error) {
	k := sha256.Sum256([]byte(key))
	block, err := aes.NewCipher(k[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &FileCipher{aead: aead}, nil
}

func (f *FileCipher) Encrypt(plain []byte) ([]byte, error) {
	nonce := make([]byte, f.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return f.aead.Seal(nonce, nonce, plain, nil), nil
}

func (f *FileCipher) Decrypt(data []byte) ([]byte, error) {
	ns := f.aead.NonceSize()
	if len(data) < ns {
		return nil, errors.New("archivo cifrado corrupto")
	}
	return f.aead.Open(nil, data[:ns], data[ns:], nil)
}
