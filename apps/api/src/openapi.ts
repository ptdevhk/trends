import fs from "node:fs";
import path from "node:path";

import { app, openApiConfig } from "./app.js";

const outputPath = process.env.OPENAPI_OUTPUT
  ? path.resolve(process.env.OPENAPI_OUTPUT)
  : path.resolve(process.cwd(), "openapi.json");

const document = app.getOpenAPI31Document(openApiConfig);
fs.writeFileSync(outputPath, JSON.stringify(document, null, 2), "utf8");
console.log(`OpenAPI spec written to ${outputPath}`);
