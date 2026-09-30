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
- **Reviewer** *(assumed)*: an internal person who looks back over submitted
sentences and their classifications to audit how the agent has been
categorizing content.

## User Stories

1. As a Calling System, I want to submit a sentence for classification, so
 that I can find out whether it is threatening.
2. As a Calling System, I want to receive a simple label — "threatening" or
 "not threatening" — so that I can act on the result programmatically
 without parsing anything more complex.
3. As a Reviewer, I want to view the log of past submitted sentences and
 their classifications, so that I can audit how the agent has been
 categorizing content over time. *(assumed)*

## Product Decisions

- **Interface**: the product is an API only — no end-user web page. Other
systems integrate directly against it.
- **Classification output**: a single label per sentence, "threatening" or
"not threatening" — no confidence score or explanation.
- **Classification approach**: an AI agent performs the categorization.
- **History**: every submitted sentence and its resulting label is kept in a
log rather than discarded after the response is returned.
- **Reviewer access**: the log is reviewed through a small internal web page,
and reviewers sign in via SSO through Thunder, the platform IDP, per this
organization's standard. *(assumed)*
- **API access**: calling systems authenticate to the API with a
machine-to-machine credential (API key) rather than a user sign-in, since
callers are systems, not people. *(assumed)*
- **Log retention**: classification log entries are kept indefinitely for
now, with no automatic expiry. *(assumed)*

## Out of Scope

- Confidence scores, explanations, or severity levels for classifications.
- Any end-user web page for submitting sentences directly (callers are
systems, not people).
- Editing or deleting log entries once recorded.
- Multi-language support — sentences are assumed to be in English.

## Open Questions

1. None currently — all decisions needed to design this product have either
 been answered or assumed above.

## Further Notes

None.