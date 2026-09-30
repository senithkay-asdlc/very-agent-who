# very-agent-who — PRD

## Problem Statement

Teams that operate messaging, support, or content-intake systems need to know
quickly whether a piece of text contains a threat, so they can route it for
attention instead of letting it pass through unnoticed. Today that judgment is
made manually or not at all, which is slow and inconsistent. There is no
lightweight, automated way for another system to ask "is this sentence
threatening?" and get a fast, dependable answer.

## Solution

A simple agent service that other systems call with a sentence and that
returns whether the sentence is threatening or not. Every submission and its
result is logged so the classifications can be reviewed later.

## Actors

- **Calling System**: an external system or application that submits a
sentence for classification and consumes the result programmatically.

## User Stories

1. As a Calling System, I want to submit a sentence for classification, so
that I can find out whether it is threatening.
2. As a Calling System, I want to receive a simple label — "threatening" or
"not threatening" — so that I can act on the result programmatically
without parsing anything more complex.

## Product Decisions

- **Interface**: the product is an API only — no end-user web page. Other
systems integrate directly against it.
- **Classification output**: a single label per sentence, "threatening" or
"not threatening" — no confidence score or explanation.
- **Classification approach**: an AI agent performs the categorization.
- **History**: every submitted sentence and its resulting label is kept in a
log rather than discarded after the response is returned. This project does
not include an interface for browsing that log — it is retained as data only.
- **API access**: the classification API is open — any caller can submit a
sentence without authenticating first, since callers are systems and the
product places no restriction on who may call it.
- **Log retention**: classification log entries are kept indefinitely, with
no automatic expiry.

## Out of Scope

- Confidence scores, explanations, or severity levels for classifications.
- Any end-user web page for submitting sentences directly (callers are
systems, not people).
- Any interface for browsing or reviewing the classification log — it is
retained as data only in this project.
- Editing or deleting log entries once recorded.
- Multi-language support — sentences are assumed to be in English.
- Authentication or rate limiting on the classification API.

## Open Questions

1. None currently — all decisions needed to design this product have either
been answered or assumed above.

## Further Notes

None.