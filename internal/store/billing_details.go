package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// BillingDetails is who a workspace's payments are from. Name and phone go to
// the payment gateway; company and address only appear on receipts.
type BillingDetails struct {
	Name      string     `json:"name"`
	Phone     string     `json:"phone"`
	Company   string     `json:"company"`
	Address   string     `json:"address"`
	City      string     `json:"city"`
	Postcode  string     `json:"postcode"`
	Country   string     `json:"country"`
	UpdatedAt *time.Time `json:"updated_at,omitempty"`
}

// GetBillingDetails returns the workspace's billing details; empty, with the
// country set to Bangladesh, when none were saved.
func (s *Store) GetBillingDetails(ctx context.Context, workspaceID int64) (BillingDetails, error) {
	if s == nil {
		return BillingDetails{}, errors.New("store is not available")
	}
	var d BillingDetails
	var updated time.Time
	err := s.db.QueryRowContext(ctx, `
		SELECT name, phone, company, address, city, postcode, country, updated_at
		FROM workspace_billing WHERE workspace_id = $1`, workspaceID).
		Scan(&d.Name, &d.Phone, &d.Company, &d.Address, &d.City, &d.Postcode, &d.Country, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return BillingDetails{Country: "BD"}, nil
	}
	if err != nil {
		return BillingDetails{}, err
	}
	d.UpdatedAt = &updated
	return d, nil
}

// SaveBillingDetails replaces the workspace's billing details.
func (s *Store) SaveBillingDetails(ctx context.Context, workspaceID int64, d BillingDetails) (BillingDetails, error) {
	if s == nil {
		return BillingDetails{}, errors.New("store is not available")
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO workspace_billing (workspace_id, name, phone, company, address, city, postcode, country, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
		ON CONFLICT (workspace_id) DO UPDATE SET
			name = EXCLUDED.name, phone = EXCLUDED.phone, company = EXCLUDED.company, address = EXCLUDED.address,
			city = EXCLUDED.city, postcode = EXCLUDED.postcode, country = EXCLUDED.country, updated_at = NOW()`,
		workspaceID, d.Name, d.Phone, d.Company, d.Address, d.City, d.Postcode, d.Country)
	if err != nil {
		return BillingDetails{}, err
	}
	return s.GetBillingDetails(ctx, workspaceID)
}
