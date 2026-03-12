export type ConvexCallType = "query" | "mutation";

export type ConvexCall = {
  type: ConvexCallType;
  pathName: string;
  args: Record<string, unknown>;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ConvexRequestInput = string | URL | { url: string };

export function parseConvexCall(
  input: ConvexRequestInput,
  init?: RequestInit,
  expectedType?: ConvexCallType,
): ConvexCall {
  const requestUrl = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  const type = requestUrl.includes("/api/query")
    ? "query"
    : requestUrl.includes("/api/mutation")
      ? "mutation"
      : null;

  if (!type) {
    throw new Error(`Unexpected request URL: ${requestUrl}`);
  }

  if (expectedType && type !== expectedType) {
    throw new Error(`Expected convex ${expectedType} request but received ${type}: ${requestUrl}`);
  }

  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  if (!isRecord(body)) {
    throw new Error("Missing convex request body");
  }

  const pathName = typeof body.path === "string" ? body.path : "";
  const args = isRecord(body.args) ? body.args : {};
  if (!pathName) {
    throw new Error("Missing convex path in request body");
  }

  return {
    type,
    pathName,
    args,
  };
}

export function convexSuccess(value: unknown): Response {
  return new Response(
    JSON.stringify({
      status: "success",
      value,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
}
