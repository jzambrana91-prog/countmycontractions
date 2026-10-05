import { defineConfig } from "astro/config";

// Static files only. Vercel serves the dist directory with no adapter.
export default defineConfig({
  site: "https://countmycontractions.com",
  trailingSlash: "never",
  build: {
    format: "file",
  },
});
