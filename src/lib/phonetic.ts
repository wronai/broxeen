const PHONETIC_RULES: Record<string, string> = {
  "ha te te pe es dwa kropki slash slash": "https://",
  "ha te te pe dwa kropki slash slash": "http://",
  "https dwa kropki slash slash": "https://",
  "http dwa kropki slash slash": "http://",
  "ha te te pe es": "https",
  "ha te te pe": "http",
  "kropka": ".",
  "dot": ".",
  "dott": ".",
  "ukośnik": "/",
  "slash": "/",
  "slasz": "/",
  "małpa": "@",
  "at": "@",
  "myślnik": "-",
  "dash": "-",
  "tire": "-",
  "podkreślnik": "_",
  "underscore": "_",
  "dwukropek": ":",
  "colon": ":",
  "trzy w": "www",
  "wuwuwu": "www",
  "wu wu wu": "www",
  "pe el": "pl",
  "pe-el": "pl",
  "peel": "pl",
  "kom": "com",
  "de i": "dev",
  "dei": "dev",
  "o er ge": "org",
  "oerge": "org",
  "net": "net",
  "ju es": "us",
  "ju kej": "uk",
  "de e": "de",
  "i u": "eu",
  "ie u": "eu",
};

const SORTED_RULES = Object.entries(PHONETIC_RULES).sort(
  (a, b) => b[0].length - a[0].length,
);

export function normalize(text: string): string {
  let result = text.toLowerCase().trim();

  for (const [spoken, replacement] of SORTED_RULES) {
    result = result.split(spoken).join(replacement);
  }

  result = result.replace(/\s*\.\s*/g, ".");
  result = result.replace(/\s*\/\s*/g, "/");
  result = result.replace(/\s*:\s*/g, ":");
  result = result.replace(/\s*@\s*/g, "@");
  result = result.replace(/\s+/g, "");

  while (result.includes("..")) {
    result = result.replace("..", ".");
  }

  result = result.replace(/\.+$/, "");
  return result;
}

export function looksLikeUrl(text: string): boolean {
  return /^(https?:\/\/)?[\w.-]+\.\w{2,}/.test(text);
}
