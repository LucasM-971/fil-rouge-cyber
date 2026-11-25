const { randomUUID } = require("node:crypto");

const MESSAGES = {
  400: "La requête n'a pas pu être traitée.",
  401: "Vous devez être connecté pour effectuer cette action.",
  403: "Vous n'avez pas accès à cette ressource.",
  404: "Cette page n'existe pas.",
  413: "Les données envoyées sont trop volumineuses.",
  500: "Une erreur est survenue. Réessayez plus tard.",
};

const TITLES = {
  401: "Connexion requise",
  403: "Accès refusé",
  404: "Page introuvable",
};

function httpError(status) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

function log(level, data) {
  console.error(JSON.stringify({ level, time: new Date().toISOString(), ...data }));
}

function render(res, status, reference = null, details = null) {
  res.status(status).render("error", {
    title: TITLES[status] || "Erreur",
    current: null,
    message: MESSAGES[status] || (status < 500 ? MESSAGES[400] : MESSAGES[500]),
    reference,
    details,
  });
}

function notFound(req, res) {
  render(res, 404);
}

function createErrorHandler({ debug }) {
  return function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);

    const status = err.status >= 400 && err.status < 600 ? err.status : 500;
    const context = { status, method: req.method, path: req.path, userId: req.user?.id ?? null };

    if (status < 500) {
      log("warn", { event: "http.denied", ...context, message: err.message });
      return render(res, status);
    }

    const reference = randomUUID().slice(0, 8);
    log("error", { reference, ...context, message: err.message, stack: err.stack });
    render(res, status, reference, debug ? err.stack : null);
  };
}

module.exports = { httpError, log, notFound, createErrorHandler };
