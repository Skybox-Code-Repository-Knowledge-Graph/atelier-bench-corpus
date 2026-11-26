package workshop

// Contact is how the customer is reached.
type Contact struct {
	Phone string `json:"phone"`
}

// TicketCard is the JSON the counter prints. It EMBEDS Contact, and
// encoding/json flattens the fields of an embedded struct into the outer
// object: the card has a top-level "phone" key, and no field of TicketCard
// itself carries it.
type TicketCard struct {
	Contact
	Number int    `json:"number"`
	Stage  string `json:"stage"`
}

// Card builds the counter card for a ticket at a stage.
func Card(ticket Ticket, phone string, stage Stage) TicketCard {
	return TicketCard{Contact: Contact{Phone: phone}, Number: ticket.Number, Stage: stage.Caption()}
}
