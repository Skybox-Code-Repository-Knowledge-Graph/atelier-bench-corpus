package workshop

// Sender delivers a ticket notice on one channel.
type Sender interface {
	Send(notice string) string
	Channel() string
}

var (
	_ Sender = SMSSender{}
	_ Sender = MailSender{}
	_ Sender = (*AuditedSender)(nil)
)

// SMSSender texts the customer.
type SMSSender struct {
	Number string
}

// Send texts the notice.
func (s SMSSender) Send(notice string) string {
	return "sms to " + s.Number + ": " + notice
}

// Channel names the text channel.
func (s SMSSender) Channel() string {
	return "sms"
}

// MailSender mails the customer.
type MailSender struct {
	Address string
}

// Send mails the notice.
func (m MailSender) Send(notice string) string {
	return "mail to " + m.Address + ": " + notice
}

// Channel names the mail channel.
func (m MailSender) Channel() string {
	return "mail"
}

// AuditedSender embeds the Sender INTERFACE, not a struct: its method set
// gains Send and Channel from whichever sender it wraps. It declares Send
// itself, to keep a trail, and leaves Channel to the embedded interface.
type AuditedSender struct {
	Sender
	Trail []string
}

// Send delivers through the wrapped sender and records the channel it used.
func (a *AuditedSender) Send(notice string) string {
	sent := a.Sender.Send(notice)
	a.Trail = append(a.Trail, a.Channel()+": "+notice)
	return sent
}
