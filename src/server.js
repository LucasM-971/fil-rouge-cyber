const path = require("node:path");
const express = require("express");
const { securityHeaders, sameOriginOnly } = require("./middleware/security");
const { notFound, createErrorHandler, log } = require("./lib/errors");
const { formatDate, formatSize } = require("./lib/format");
const { loadSession } = require("./auth/session");
const { requireAuth } = require("./middleware/access");
const authRouter = require("./routes/auth");
const notesRouter = require("./routes/notes");
const filesRouter = require("./routes/files");
const adminRouter = require("./routes/admin");
const accountRouter = require("./routes/account");
const healthRouter = require("./routes/health");

const env = process.env.NODE_ENV || "production";
const PORT = 8000;

const app = express();

app.set("env", env);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.disable("x-powered-by");
app.set("trust proxy", "uniquelocal");
app.locals.formatDate = formatDate;
app.locals.formatSize = formatSize;

app.use(securityHeaders);
app.use(express.static(path.join(__dirname, "..", "public"), { index: false }));
app.use(healthRouter);
app.use(sameOriginOnly);
app.use(express.urlencoded({ extended: false, limit: "16kb" }));
app.use(loadSession);

app.use(authRouter);
app.use(requireAuth);
app.use(notesRouter);
app.use(filesRouter);
app.use(accountRouter);
app.use("/admin", adminRouter);

app.use(notFound);
app.use(createErrorHandler({ debug: env === "development" }));

const server = app.listen(PORT, () => log("info", { message: `Rempart écoute sur :${PORT}`, env }));

process.on("SIGTERM", () => server.close(() => process.exit(0)));
