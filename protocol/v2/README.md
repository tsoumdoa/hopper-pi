# Hopper RPC protocol v2

`hopper-rpc.schema.json` defines the JSON request, operation response, protocol-error response, runtime status, and retained mutation-result shapes. `metadata.json` repeats the wire framing, operation classes, result classes, and reason codes in a form that C# and TypeScript tests can read without parsing schema annotations. `fixtures.json` contains the shared valid and invalid examples.

The Node DEALER sends one UTF-8 JSON payload frame. The Rhino ROUTER receives the stable Node routing identity followed by that payload. Replies reverse the path: ROUTER sends the routing identity and one payload frame, while DEALER receives the payload. Neither side adds an empty delimiter frame. The routing identity is opaque transport data and never appears in JSON.

The operation name determines its class. Queries and lifecycle controls omit `operationId`. Document mutations require it in both request and response envelopes. Domain-operation `args` are open JSON objects so this contract does not duplicate each tool schema. Lifecycle handshake, status, Grasshopper start, result lookup, and cancellation use exact argument or result shapes.

Rhino sends `outcome_unknown` neither as an RPC response nor as a retained result. Node creates that local result only when its completion budget ends after an operation may have started.

The ROUTER returns a `protocol_error` when it can recover a valid `requestId` from a rejected payload. It may echo a valid lifecycle ID and the received operation name; either may be null. If no valid request ID can be recovered, the ROUTER drops the payload and records a transport error instead of inventing a correlation ID.
