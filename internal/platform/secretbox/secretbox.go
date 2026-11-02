// Package secretbox encrypts small secrets, such as TOTP seeds, before they
// are stored. It uses AES-256-GCM with a key from configuration.
package secretbox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
)

const (
	sealedPrefix = "v1:"
	// plainPrefix marks values stored without a key, in development only.
	plainPrefix = "plain:"
)

// Box seals and opens secrets. A Box without a key stores values marked as
// plain text, so local development works; production must set a key.
type Box struct {
	aead cipher.AEAD
}

// New builds a Box from a base64 key of 32 bytes. An empty key gives a Box
// that does not encrypt.
func New(key string) (*Box, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return &Box{}, nil
	}
	raw, err := base64.StdEncoding.DecodeString(key)
	if err != nil {
		return nil, fmt.Errorf("encryption key must be base64: %w", err)
	}
	if len(raw) != 32 {
		return nil, fmt.Errorf("encryption key must be 32 bytes, got %d", len(raw))
	}
	block, err := aes.NewCipher(raw)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Box{aead: aead}, nil
}

// Encrypts reports whether the Box has a key.
func (b *Box) Encrypts() bool {
	return b != nil && b.aead != nil
}

// Seal encrypts plaintext.
func (b *Box) Seal(plaintext string) (string, error) {
	if !b.Encrypts() {
		return plainPrefix + plaintext, nil
	}
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := b.aead.Seal(nonce, nonce, []byte(plaintext), nil)
	return sealedPrefix + base64.StdEncoding.EncodeToString(sealed), nil
}

// Open decrypts a value from Seal.
func (b *Box) Open(value string) (string, error) {
	switch {
	case strings.HasPrefix(value, plainPrefix):
		return strings.TrimPrefix(value, plainPrefix), nil
	case strings.HasPrefix(value, sealedPrefix):
		if !b.Encrypts() {
			return "", errors.New("secret is encrypted but no encryption key is configured")
		}
		raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(value, sealedPrefix))
		if err != nil {
			return "", err
		}
		size := b.aead.NonceSize()
		if len(raw) < size {
			return "", errors.New("sealed secret is too short")
		}
		plain, err := b.aead.Open(nil, raw[:size], raw[size:], nil)
		if err != nil {
			return "", errors.New("could not decrypt secret; was the encryption key changed?")
		}
		return string(plain), nil
	default:
		return "", errors.New("unrecognised secret format")
	}
}
