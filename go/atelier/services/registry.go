package services

import (
	"sort"

	"atelier.example/lane/atelier/contracts"
)

// All builds the 12 services, sorted by name. Services hold no registration
// state, so none registers itself in an init function the way reports and
// metrics do: this list is the one place every service is constructed.
func All() []contracts.ServiceContract {
	all := []contracts.ServiceContract{
		NewBacklogService(),
		NewChurnRiskService(),
		NewCustomerRetentionService(),
		NewInventoryTurnoverService(),
		NewOrderVolumeService(),
		NewPartUsageService(),
		NewPaymentLatencyService(),
		NewProfitMarginService(),
		NewRevenueService(),
		NewTechnicianLoadService(),
		NewThroughputService(),
		NewWarrantyClaimService(),
	}
	sort.Slice(all, func(i, j int) bool { return all[i].Name() < all[j].Name() })
	return all
}
