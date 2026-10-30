package security

import (
	"bytes"
	"encoding/base32"
	"testing"
	"time"
)

func TestPasswordHashing(t *testing.T) {
	h, err := HashPassword("Sigo2026!")
	if err != nil {
		t.Fatal(err)
	}
	if !CheckPassword(h, "Sigo2026!") || CheckPassword(h, "otra") {
		t.Error("verificación bcrypt incorrecta")
	}
}

func TestPasswordPolicy(t *testing.T) {
	for _, bad := range []string{"corta1A", "sinmayusculas1", "SINMINUSCULAS1", "SinNumeros"} {
		if ValidatePasswordPolicy(bad) == nil {
			t.Errorf("%q debería rechazarse", bad)
		}
	}
	if ValidatePasswordPolicy("Segura2026") != nil {
		t.Error("contraseña válida rechazada")
	}
}

func TestJWT(t *testing.T) {
	secret := []byte("secreto-de-prueba")
	tok, err := IssueToken(secret, Claims{UserID: 3, Role: "odontologo", MFA: true}, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	c, err := ParseToken(secret, tok)
	if err != nil || c.UserID != 3 || c.Role != "odontologo" || !c.MFA {
		t.Fatalf("claims inválidos: %+v %v", c, err)
	}
	if _, err := ParseToken([]byte("otro"), tok); err == nil {
		t.Error("token con firma distinta debe rechazarse")
	}
	expired, _ := IssueToken(secret, Claims{UserID: 1}, -time.Minute)
	if _, err := ParseToken(secret, expired); err == nil {
		t.Error("token expirado debe rechazarse")
	}
}

// Vector de prueba del RFC 6238 (SHA-1, T = 59 s → 94287082, 8 dígitos; 6 dígitos → 287082).
func TestTOTPRFC6238(t *testing.T) {
	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString([]byte("12345678901234567890"))
	code, err := TOTPCode(secret, time.Unix(59, 0))
	if err != nil {
		t.Fatal(err)
	}
	if code != "287082" {
		t.Errorf("TOTP = %s, se esperaba 287082", code)
	}
	now, _ := TOTPCode(secret, time.Now())
	if !VerifyTOTP(secret, now) || VerifyTOTP(secret, "000000x") {
		t.Error("verificación TOTP incorrecta")
	}
}

func TestFileCipherAES256(t *testing.T) {
	fc, err := NewFileCipher("clave")
	if err != nil {
		t.Fatal(err)
	}
	plain := []byte("radiografía panorámica")
	enc, err := fc.Encrypt(plain)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(enc, plain) {
		t.Error("el contenido cifrado no debe contener el texto plano")
	}
	dec, err := fc.Decrypt(enc)
	if err != nil || !bytes.Equal(dec, plain) {
		t.Fatal("descifrado incorrecto")
	}
	enc[len(enc)-1] ^= 0xff
	if _, err := fc.Decrypt(enc); err == nil {
		t.Error("GCM debe detectar manipulación")
	}
}

func TestRandomDigits(t *testing.T) {
	d := RandomDigits(6)
	if len(d) != 6 {
		t.Fatal("longitud incorrecta")
	}
	for _, r := range d {
		if r < '0' || r > '9' {
			t.Fatal("solo dígitos")
		}
	}
}
