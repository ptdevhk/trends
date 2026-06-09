/**
 * Idempotent local user + workspace membership bootstrap script.
 *
 * Usage:
 *   AUTH_BOOTSTRAP_PASSWORD='secret' bun run scripts/auth/manage-user.ts \
 *     --username hr-admin --email hr@example.com --display-name "HR Admin" \
 *     --workspace hr --role admin --password-env AUTH_BOOTSTRAP_PASSWORD --output json
 *
 * Password input priority: --password-env > --password-stdin > --no-password
 * Never echoes passwords in stdout/stderr.
 */

import { AuthStorage } from "../../apps/api/src/services/auth-storage.js";
import { hashPassword } from "../../apps/api/src/services/local-password-provider.js";
import { resetResumeScreeningDb } from "../../apps/api/src/services/database.js";

type Args = {
  username: string;
  email?: string;
  displayName?: string;
  workspace: string;
  role: "user" | "admin";
  passwordEnv?: string;
  passwordStdin: boolean;
  noPassword: boolean;
  dryRun: boolean;
  output: "json" | "agent";
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    username: "",
    workspace: "",
    role: "user",
    passwordStdin: false,
    noPassword: false,
    dryRun: false,
    output: "json",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--username":
        args.username = argv[++i] ?? "";
        break;
      case "--email":
        args.email = argv[++i];
        break;
      case "--display-name":
        args.displayName = argv[++i];
        break;
      case "--workspace":
        args.workspace = argv[++i] ?? "";
        break;
      case "--role":
        args.role = (argv[++i] ?? "user") as "user" | "admin";
        break;
      case "--password-env":
        args.passwordEnv = argv[++i];
        break;
      case "--password-stdin":
        args.passwordStdin = true;
        break;
      case "--no-password":
        args.noPassword = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--output":
        args.output = (argv[++i] ?? "json") as "json" | "agent";
        break;
    }
  }

  return args;
}

async function readPassword(args: Args): Promise<string | null> {
  if (args.noPassword) {
    return null;
  }

  if (args.passwordEnv) {
    const value = process.env[args.passwordEnv];
    if (!value) {
      console.error(`Error: environment variable ${args.passwordEnv} is not set`);
      process.exit(1);
    }
    return value;
  }

  if (args.passwordStdin) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf-8").trim();
    if (!raw) {
      console.error("Error: no password provided via stdin");
      process.exit(1);
    }
    return raw;
  }

  console.error("Error: specify --password-env, --password-stdin, or --no-password");
  process.exit(1);
}

type UpsertResult = {
  userId: string;
  created: boolean;
  membershipCreated: boolean;
  workspace: string;
  role: string;
};

function upsertUser(
  storage: AuthStorage,
  args: Args,
  passwordHash: string | null,
): UpsertResult {
  const existingIdentity = storage.findIdentity("local", args.username, "local");
  let userId: string;
  let created = false;

  if (existingIdentity) {
    userId = existingIdentity.userId;
    const existingUser = storage.findUser(userId);
    if (existingUser && (args.email || args.displayName)) {
      // Update user fields via re-create (upsert pattern)
      storage.createUser({ email: args.email ?? existingUser.email, displayName: args.displayName ?? existingUser.displayName });
    }
  } else {
    const user = storage.createUser({
      email: args.email,
      displayName: args.displayName,
    });
    userId = user.id;
    created = true;
    storage.linkIdentity({
      userId,
      provider: "local",
      providerSubject: args.username,
      providerTenant: "local",
      email: args.email,
      displayName: args.displayName,
    });
  }

  if (passwordHash) {
    // hashPassword is async so we handle it outside
    throw new Error("Use async upsertUserWithPassword instead");
  }

  const existingMembership = storage.listMemberships(userId).find(
    (m) => m.workspaceSlug === args.workspace,
  );
  storage.upsertMembership({
    userId,
    workspaceSlug: args.workspace,
    role: args.role,
  });

  return {
    userId,
    created,
    membershipCreated: !existingMembership,
    workspace: args.workspace,
    role: args.role,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.username) {
    console.error("Error: --username is required");
    process.exit(1);
  }
  if (!args.workspace) {
    console.error("Error: --workspace is required");
    process.exit(1);
  }
  if (!["user", "admin"].includes(args.role)) {
    console.error("Error: --role must be 'user' or 'admin'");
    process.exit(1);
  }

  const password = await readPassword(args);

  if (args.dryRun) {
    const output = {
      dryRun: true,
      username: args.username,
      email: args.email,
      displayName: args.displayName,
      workspace: args.workspace,
      role: args.role,
      passwordProvided: password !== null,
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const storage = new AuthStorage();

  // Check if identity exists to determine create vs update
  const existingIdentity = storage.findIdentity("local", args.username, "local");
  let userId: string;
  let created = false;

  if (existingIdentity) {
    userId = existingIdentity.userId;
  } else {
    const user = storage.createUser({
      email: args.email,
      displayName: args.displayName,
    });
    userId = user.id;
    created = true;
    storage.linkIdentity({
      userId,
      provider: "local",
      providerSubject: args.username,
      providerTenant: "local",
      email: args.email,
      displayName: args.displayName,
    });
  }

  // Save password if provided
  if (password) {
    const hashed = await hashPassword(password);
    storage.savePasswordCredential({
      userId,
      ...hashed,
      mustChangePassword: false,
    });
  }

  // Upsert workspace membership
  const existingMembership = storage.listMemberships(userId).find(
    (m) => m.workspaceSlug === args.workspace,
  );
  storage.upsertMembership({
    userId,
    workspaceSlug: args.workspace,
    role: args.role,
  });

  const memberships = storage.listMemberships(userId);

  const output = {
    success: true,
    userId,
    created,
    passwordSet: password !== null,
    membership: {
      workspace: args.workspace,
      role: args.role,
      created: !existingMembership,
    },
    totalMemberships: memberships.length,
  };

  console.log(JSON.stringify(output, null, 2));

  // Cleanup DB connection
  resetResumeScreeningDb();
}

main().catch((error) => {
  console.error("Fatal error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
