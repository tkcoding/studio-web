# Invoice reminders: sync 3 Nov

Present: Dana, Ravi, Mei, Tomas. Notes by Mei, typed fast, sorry.

- Recap: customers pay late and finance chases by hand. Goal is fewer chases.
- Reminder emails: send one 3 days before the due date and one the day after if still unpaid.
  Ravi says finance wants this not to be hardcoded, so the days must be settable per customer.
- Dana: a customer who has paid must never get a reminder. Check the payment status right before
  sending, not when the reminder was planned.
- maybe SMS later? not for v1
- Tomas to ask legal about the wording of the 2nd email (action, not a requirement)
- Finance needs a screen listing every invoice that got a reminder, with the date it was sent and
  whether it was opened.
- Reminder emails come from finance@ and not from a person's address, decided.
- Ravi worried about volume: 20k invoices a month now, should be fine, but the nightly run has to
  finish within 30 minutes even at 100k.
- Who gets the weekly summary? unclear, Dana will find out
- Anything we send must be kept for 7 years because of the audit rules.
- Lunch spot for the team day: Mei to poll

Next sync Thursday.
