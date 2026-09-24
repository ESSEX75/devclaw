const bundleUrl = new URL("../dist/index.js", import.meta.url);

await import(bundleUrl.href);

console.log("Verified dist/index.js can be imported as ESM.");
