package api

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"qnetward/internal/store"
)

var (
	// A Bangladeshi mobile number: 01, an operator digit 3 to 9, then eight digits.
	bdMobile = regexp.MustCompile(`^01[3-9][0-9]{8}$`)
	// Elsewhere: an international number, + and 7 to 15 digits.
	intlPhone   = regexp.MustCompile(`^\+[1-9][0-9]{6,14}$`)
	countryCode = regexp.MustCompile(`^[A-Z]{2}$`)
)

// normalizePhone accepts a number as people type it (spaces, dashes, +880 or
// 880 in front) and returns it in one form: 01XXXXXXXXX in Bangladesh,
// +<digits> elsewhere.
func normalizePhone(raw, country string) (string, error) {
	var b strings.Builder
	for i, r := range strings.TrimSpace(raw) {
		switch {
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '+' && i == 0:
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '(' || r == ')' || r == '.':
		default:
			return "", errors.New("the phone number can only have digits, spaces, and dashes")
		}
	}
	phone := b.String()
	if country == "BD" || strings.HasPrefix(phone, "+880") || strings.HasPrefix(phone, "880") {
		phone = strings.TrimPrefix(strings.TrimPrefix(phone, "+"), "88")
		if !bdMobile.MatchString(phone) {
			return "", errors.New("enter a Bangladeshi mobile number, like 01712345678")
		}
		return phone, nil
	}
	if !strings.HasPrefix(phone, "+") {
		phone = "+" + phone
	}
	if !intlPhone.MatchString(phone) {
		return "", errors.New("enter the phone number with its country code, like +44 20 7946 0958")
	}
	return phone, nil
}

// cleanBillingDetails trims and checks what a customer typed.
func cleanBillingDetails(in store.BillingDetails) (store.BillingDetails, error) {
	out := store.BillingDetails{
		Name:     strings.Join(strings.Fields(in.Name), " "),
		Company:  strings.TrimSpace(in.Company),
		Address:  strings.TrimSpace(in.Address),
		City:     strings.TrimSpace(in.City),
		Postcode: strings.TrimSpace(in.Postcode),
		Country:  strings.ToUpper(strings.TrimSpace(in.Country)),
	}
	if out.Country == "" {
		out.Country = "BD"
	}
	if !countryCode.MatchString(out.Country) {
		return out, errors.New("pick a country")
	}
	if out.Name == "" {
		return out, errors.New("enter the name payments should be from")
	}
	for _, f := range []struct {
		value, label string
		max          int
	}{{out.Name, "name", 100}, {out.Company, "company", 120}, {out.Address, "address", 200}, {out.City, "city", 80}, {out.Postcode, "postcode", 20}} {
		if utf8.RuneCountInString(f.value) > f.max {
			return out, errors.New("the " + f.label + " is too long")
		}
	}
	phone, err := normalizePhone(in.Phone, out.Country)
	if err != nil {
		return out, err
	}
	out.Phone = phone
	return out, nil
}

// handleBillingDetails reads (GET) or saves (PUT) who the workspace's
// payments are from. Owners and admins only: it holds a phone number.
func (srv *Server) handleBillingDetails(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPut {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if r.Method == http.MethodPut && !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}
	user, workspace, ok := srv.billingWorkspace(w, r)
	if !ok {
		return
	}
	if !canManageBilling(workspace) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "only workspace owners and admins can see billing details"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	if r.Method == http.MethodGet {
		details, err := srv.store.GetBillingDetails(ctx, workspace.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: "couldn't load billing details"})
			return
		}
		if details.Name == "" {
			details.Name = strings.TrimSpace(user.Name)
		}
		writeJSON(w, http.StatusOK, details)
		return
	}
	if srv.isDemoUser(user) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "the shared demo account can't change billing details"})
		return
	}
	var req store.BillingDetails
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	clean, err := cleanBillingDetails(req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	saved, err := srv.store.SaveBillingDetails(ctx, workspace.ID, clean)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "couldn't save billing details"})
		return
	}
	srv.recordAudit(r, workspace.ID, user, "billing.details_updated", auditTarget{Type: "workspace", ID: "billing", Label: "Billing details"}, nil)
	writeJSON(w, http.StatusOK, saved)
}
