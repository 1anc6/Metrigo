// Vercel serverless entry: the whole Express API runs as this one function.
// vercel.json rewrites the API paths here; the pages in FrontEnd/ are served
// as static files.
module.exports = require("../Backend/server.js");
