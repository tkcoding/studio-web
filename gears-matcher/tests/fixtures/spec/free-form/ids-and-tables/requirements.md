# Parcel locker network: requirements

Version 0.3, owner: Anja. Replaces the earlier Word list.

## 1. Functional

### FR-1 Collection by code

A recipient collects a parcel by typing the six-digit code from the notification message into the
locker's screen. A code works once and only for the locker it was issued for.

### FR-2 Expiry

If a parcel is not collected within 72 hours of being placed in the locker, it is taken out by the
carrier on the next round and the recipient is told.

### FR-3 Oversize parcels

The system should tell the carrier before they travel when a parcel does not fit any free compartment.
This is not required for the pilot.

## 2. Requirements table

| ID | Statement | Priority |
|----|-----------|----------|
| REQ-10 | The locker shows its own address and opening hours on the idle screen. | must |
| REQ-11 | A carrier opens every compartment of a locker with one scan of their badge. | must |
| REQ-12 | Lockers keep working for 48 hours without a network connection and send their log when it returns. | should |

## 3. Quality

- NFR-1: a recipient completes collection in under 20 seconds from the first touch.
- NFR-2: the notification message reaches the recipient within 60 seconds of the parcel being
  placed in the locker, in 99% of cases.
- NFR-3 (draft): the network should be "highly available".

## 4. Notes

The pilot starts in three cities. See also FR-1 and REQ-11 for what is in scope for the pilot.
Anja will ask legal whether we may keep recipients' phone numbers for 30 days.
