// ArcMap Raster Calculator map algebra -> terrio calc (gdal_calc / NumPy syntax).
//
// ArcMap writes rasters as quoted layer names ("b8") and uses functions such as Con, SetNull,
// Float and RoundUp. terrio's calc takes rasters as single letters and NumPy names (where,
// arcsin, floor...). translate() maps each quoted name to a letter in order of appearance and
// rewrites the functions; NumPy names typed directly pass through unchanged.

/** The functions the calculator lists, grouped as ArcMap does, with a one-line description. */
export const FUNCTIONS = {
  Conditional: [
    ["Con", "Con(condition, true_value, false_value): if/else per cell. Without false_value, cells that fail are NoData."],
    ["Pick", "Pick(position, value1, value2, …): takes value N where position is N, else NoData."],
    ["SetNull", "SetNull(condition, value): NoData where the condition is true, else value."],
    ["IsNull", "IsNull(raster): 1 where the cell is NoData, else 0."],
  ],
  Math: [
    ["Abs", "Abs(x): absolute value."],
    ["Exp", "Exp(x): e to the power x."],
    ["Exp10", "Exp10(x): 10 to the power x."],
    ["Exp2", "Exp2(x): 2 to the power x."],
    ["Float", "Float(x): converts to floating point, so division keeps decimals."],
    ["Int", "Int(x): truncates to a whole number."],
    ["Ln", "Ln(x): natural logarithm."],
    ["Log10", "Log10(x): base-10 logarithm."],
    ["Log2", "Log2(x): base-2 logarithm."],
    ["Mod", "Mod(x, y): remainder of x / y."],
    ["Power", "Power(x, y): x to the power y."],
    ["RoundDown", "RoundDown(x): largest whole number not above x."],
    ["RoundUp", "RoundUp(x): smallest whole number not below x."],
    ["Square", "Square(x): x times x."],
    ["SquareRoot", "SquareRoot(x): square root."],
  ],
  Trigonometric: [
    ["ACos", "ACos(x): inverse cosine, in radians."],
    ["ACosH", "ACosH(x): inverse hyperbolic cosine."],
    ["ASin", "ASin(x): inverse sine, in radians."],
    ["ASinH", "ASinH(x): inverse hyperbolic sine."],
    ["ATan", "ATan(x): inverse tangent, in radians."],
    ["ATan2", "ATan2(y, x): angle of the point (x, y), in radians."],
    ["ATanH", "ATanH(x): inverse hyperbolic tangent."],
    ["Cos", "Cos(x): cosine of an angle in radians."],
    ["CosH", "CosH(x): hyperbolic cosine."],
    ["Sin", "Sin(x): sine of an angle in radians."],
    ["SinH", "SinH(x): hyperbolic sine."],
    ["Tan", "Tan(x): tangent of an angle in radians."],
    ["TanH", "TanH(x): hyperbolic tangent."],
  ],
};

const SIMPLE = {
  abs: "abs",
  exp: "exp",
  exp2: "exp2",
  ln: "log",
  log10: "log10",
  log2: "log2",
  rounddown: "floor",
  roundup: "ceil",
  square: "square",
  squareroot: "sqrt",
  int: "trunc",
  acos: "arccos",
  acosh: "arccosh",
  asin: "arcsin",
  asinh: "arcsinh",
  atan: "arctan",
  atan2: "arctan2",
  atanh: "arctanh",
  cos: "cos",
  cosh: "cosh",
  sin: "sin",
  sinh: "sinh",
  tan: "tan",
  tanh: "tanh",
  mod: "fmod",
  power: "power",
  isnull: "isnan",
};
const ARITY = { con: [2, 3], setnull: [2, 2], pick: [2, 99], float: [1, 1], exp10: [1, 1], mod: [2, 2], power: [2, 2], atan2: [2, 2] };
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Split "a, f(b, c), d" at top-level commas. */
function splitArgs(s) {
  const out = [];
  let depth = 0;
  let cur = "";
  let quote = false;
  for (const ch of s) {
    if (ch === '"') quote = !quote;
    if (!quote && ch === "(") depth++;
    if (!quote && ch === ")") depth--;
    if (!quote && ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((a) => a.trim());
}

/**
 * Translate an ArcMap map algebra expression.
 *
 * @param {string} expression e.g. `Con(Float("b8" - "b4") / Float("b8" + "b4") > 0.4, 1, 0)`
 * @returns {{ expr: string, rasters: string[] }} the terrio expression and the raster names it
 *   reads, in the order of their letters (A, B, C…).
 * @throws {Error} on unbalanced parentheses or quotes, a wrong number of arguments, or more
 *   than 26 rasters.
 */
/**
 * Two values side by side with nothing between them ("b8"."b4", "a" "b", "a" 2) are a typo
 * that NumPy syntax would either reject with a cryptic message or, for ".", read as an
 * attribute. Say which two values need an operator.
 */
function checkOperators(expression) {
  const TOKEN = /"[^"]*"|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_]\w*|==|!=|>=|<=|\*\*|\S/g;
  const toks = expression.match(TOKEN) ?? [];
  const show = (t) => (t.startsWith('"') ? t : `"${t}"`);
  const isValue = (t) => t.startsWith('"') || /^[\d.]/.test(t) && t !== "." || /^[A-Za-z_]/.test(t);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === ".") {
      const prev = toks[i - 1], next = toks[i + 1];
      throw new Error(`"." is not an operator${prev && next ? ` (between ${show(prev)} and ${show(next)})` : ""}: use - + * / or another operator`);
    }
    const next = toks[i + 1];
    if (!next) break;
    const ends = isValue(t) && !(/^[A-Za-z_]/.test(t) && next === "(") || t === ")";
    const starts = isValue(next) || next === "(";
    if (ends && starts) throw new Error(`Missing operator between ${show(t)} and ${show(next)}`);
  }
}

export function translate(expression) {
  const rasters = [];
  const letterOf = (name) => {
    let i = rasters.indexOf(name);
    if (i < 0) {
      if (rasters.length >= LETTERS.length) throw new Error("At most 26 rasters can be used");
      rasters.push(name);
      i = rasters.length - 1;
    }
    return LETTERS[i];
  };
  if ((expression.match(/"/g) ?? []).length % 2) throw new Error("A raster name is missing its closing quote");
  checkOperators(expression);

  function walk(s) {
    let out = "";
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '"') {
        const end = s.indexOf('"', i + 1);
        const name = s.slice(i + 1, end);
        if (!name.trim()) throw new Error('Empty raster name ""');
        out += letterOf(name);
        i = end + 1;
        continue;
      }
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
      if (m) {
        const word = m[0];
        let j = i + word.length;
        while (s[j] === " ") j++;
        if (s[j] === "(") {
          // find the matching parenthesis
          let depth = 0;
          let k = j;
          let quote = false;
          for (; k < s.length; k++) {
            if (s[k] === '"') quote = !quote;
            if (quote) continue;
            if (s[k] === "(") depth++;
            else if (s[k] === ")" && --depth === 0) break;
          }
          if (depth !== 0) throw new Error(`Missing ")" after ${word}(`);
          const args = splitArgs(s.slice(j + 1, k)).filter((a, idx, all) => !(all.length === 1 && a === ""));
          out += call(word, args.map(walk));
          i = k + 1;
          continue;
        }
        out += word;
        i += word.length;
        continue;
      }
      out += ch;
      i++;
    }
    return out;
  }

  function call(word, args) {
    const key = word.toLowerCase();
    const arity = ARITY[key] ?? (SIMPLE[key] ? [1, 1] : null);
    if (arity && (args.length < arity[0] || args.length > arity[1])) {
      throw new Error(`${word} takes ${arity[0] === arity[1] ? arity[0] : `${arity[0]} to ${arity[1] === 99 ? "many" : arity[1]}`} argument${arity[1] === 1 ? "" : "s"}, got ${args.length}`);
    }
    switch (key) {
      case "con":
        return `where(${args[0]}, ${args[1]}, ${args[2] ?? "nan"})`;
      case "setnull":
        return `where(${args[0]}, nan, ${args[1]})`;
      case "pick": {
        let e = "nan";
        for (let n = args.length - 1; n >= 1; n--) e = `where((${args[0]}) == ${n}, ${args[n]}, ${e})`;
        return e;
      }
      case "float":
        return `(1.0 * (${args[0]}))`;
      case "exp10":
        return `(10.0 ** (${args[0]}))`;
      case "isnull":
        return `(1.0 * isnan(${args[0]}))`;
      default:
        return `${SIMPLE[key] ?? word}(${args.join(", ")})`;
    }
  }

  const expr = walk(expression.trim());
  if (!expr) throw new Error("The expression is empty");
  let depth = 0;
  for (const ch of expr) {
    if (ch === "(") depth++;
    if (ch === ")" && --depth < 0) throw new Error('There is a ")" without its "("');
  }
  if (depth) throw new Error('A "(" is not closed');
  return { expr, rasters };
}
