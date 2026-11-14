package api

import (
	"context"
	"log"
	"time"
)

const (
	// paymentReconcileEvery is how often pending payments are checked with the gateway.
	paymentReconcileEvery = 2 * time.Minute
	// paymentReconcileWindow is how long after checkout a payment keeps being checked.
	paymentReconcileWindow = 48 * time.Hour
	paymentReconcileBatch  = 50
)

// RunPaymentReconciler settles payments the browser never came back from.
// UddoktaPay sends its webhook only when an admin presses a button, so a
// customer who pays and then closes the tab would otherwise be charged
// without getting the plan. Every few minutes this asks the gateway about each
// recent pending payment and applies the ones that were paid. It is safe on
// several instances at once: completing a payment twice changes nothing.
func (srv *Server) RunPaymentReconciler(ctx context.Context) {
	if srv.store == nil {
		return
	}
	ticker := time.NewTicker(paymentReconcileEvery)
	defer ticker.Stop()
	for tick := 0; ; tick++ {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			srv.reconcilePayments(ctx, tick)
		}
	}
}

// reconcileDue says whether a checkout of this age is asked about on this
// tick. Most people pay within minutes, so young checkouts are asked about
// every tick; older ones less and less, which keeps an abandoned checkout to
// about a hundred questions to the gateway over its two days instead of
// fourteen hundred. Tick 0, the first after a start, asks about all of them.
func reconcileDue(age time.Duration, tick int) bool {
	switch {
	case tick == 0 || age < time.Hour:
		return true
	case age < 6*time.Hour:
		return tick%8 == 0 // about every 16 minutes
	default:
		return tick%30 == 0 // about every hour
	}
}

// reconcilePayments checks the pending payments due on this tick with the gateway.
func (srv *Server) reconcilePayments(ctx context.Context, tick int) {
	if !srv.payments.Configured() {
		return
	}
	listCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	pending, err := srv.store.PaymentsToReconcile(listCtx, time.Now().Add(-paymentReconcileWindow), paymentReconcileBatch)
	cancel()
	if err != nil {
		log.Printf("listing payments to reconcile failed: %v", err)
		return
	}
	// Checkouts nobody paid within the window stop being checked and leave the list.
	expireCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	if _, err := srv.store.ExpireStalePayments(expireCtx, time.Now().Add(-paymentReconcileWindow)); err != nil {
		log.Printf("expiring unpaid checkouts failed: %v", err)
	}
	cancel()
	for _, p := range pending {
		if ctx.Err() != nil {
			return
		}
		if !reconcileDue(time.Since(p.CreatedAt), tick) {
			continue
		}
		settleCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		outcome, _ := srv.settlePayment(settleCtx, nil, p.InvoiceID)
		cancel()
		if outcome == "success" {
			log.Printf("payment %d was paid without coming back from the gateway; plan applied", p.ID)
		}
	}
}
