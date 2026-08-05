// Проверка блока настроек в index.html. Запускается локально (node check-config.js)
// и автоматически на GitHub после каждой правки — в том числе сделанной прямо в браузере.
const fs = require("fs");
const html = fs.readFileSync(__dirname + "/index.html", "utf8");

const problems = [];
const marker = 'id="rates-config">';

if (!html.includes(marker)) {
  problems.push("в index.html нет блока настроек (script id=\"rates-config\")");
} else {
  const raw = html.split(marker)[1].split("</script>")[0];
  let cfg = null;
  try {
    cfg = JSON.parse(raw);
  } catch (err) {
    problems.push("блок настроек — не корректный JSON (обычно лишняя или пропущенная запятая): " + err.message);
  }

  if (cfg) {
    // Обязательные значения: без любого из них расчёт молча даст NaN.
    const numbers = {
      "employee.fszn_rate": [0, 1],
      "employee.income_tax_rate": [0, 1],
      "employee.union_rate_default": [0, 1],
      "employee.dpns_rate_min": [0, 1],
      "employee.dpns_rate_max": [0, 1],
      "employer.fszn_pension_rate": [0, 1],
      "employer.fszn_social_rate": [0, 1],
      "employer.belgosstrakh_rate_default": [0, 1],
      "employer.dpns_employer_match_max": [0, 1],
      "deductions.personal": [0, 100000],
      "deductions.personal_income_threshold": [0, 1000000],
      "deductions.child": [0, 100000],
      "deductions.child_enhanced": [0, 100000],
      "deductions.special_category": [0, 100000],
      "year": [2020, 2100]
    };
    const get = (path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), cfg);

    for (const [path, [min, max]] of Object.entries(numbers)) {
      const v = get(path);
      if (v == null) problems.push("нет значения " + path);
      else if (typeof v !== "number" || !isFinite(v)) problems.push(path + " — не число: " + JSON.stringify(v));
      else if (v < min || v > max) problems.push(path + " = " + v + " вне разумного диапазона " + min + "–" + max
        + (max === 1 ? " (ставки задаются долей единицы: 13% это 0.13, а не 13)" : ""));
    }
    if (typeof get("rates_valid_from") !== "string") problems.push("нет даты rates_valid_from");
    if (get("employee.dpns_rate_min") > get("employee.dpns_rate_max")) {
      problems.push("dpns_rate_min больше dpns_rate_max");
    }
  }
}

// Тесты вытаскивают логику из index.html по этим меткам — если их переименовать, тесты замолчат.
["const rub =", "/* ----------------------------- Утилиты", "function calc(", "function grossFromNet("]
  .forEach((m) => { if (!html.includes(m)) problems.push("в index.html пропала метка «" + m + "», от неё зависит test.js"); });

// ---- Рабочее место бухгалтера: справочник кодов табеля ----
const hubPath = __dirname + "/buh_hub.html";
if (fs.existsSync(hubPath)) {
  const hub = fs.readFileSync(hubPath, "utf8");
  const hubMarker = 'id="codes-config">';

  if (!hub.includes(hubMarker)) {
    problems.push("в buh_hub.html нет блока с кодами табеля (script id=\"codes-config\")");
  } else {
    let cfg = null;
    try {
      cfg = JSON.parse(hub.split(hubMarker)[1].split("</script>")[0]);
    } catch (err) {
      problems.push("справочник кодов табеля — не корректный JSON: " + err.message);
    }
    if (cfg) {
      const codes = cfg["коды"];
      if (!codes || typeof codes !== "object") problems.push("в справочнике нет раздела «коды»");
      else {
        Object.keys(codes).forEach((k) => {
          const c = codes[k];
          if (typeof c["название"] !== "string" || !c["название"]) {
            problems.push("у кода «" + k + "» нет названия");
          }
          ["списочная", "срсч", "средняя"].forEach((flag) => {
            if (typeof c[flag] !== "boolean") {
              problems.push("у кода «" + k + "» флаг «" + flag + "» должен быть true или false, сейчас "
                + JSON.stringify(c[flag]) + " (кавычки вокруг true не нужны)");
            }
          });
        });
        if (!Object.keys(codes).length) problems.push("справочник кодов табеля пуст");
      }
    }
  }

  // Тест вытаскивает ядро расчёта из buh_hub.html по этим меткам.
  ["const CP1251_HIGH =", "ЯДРО: конец.", "function parseTabel(", "function computeHeadcount(",
   "function classifyEmployees(", "function classifyDay(", "function readSpreadsheet(",
   "function inflateRaw(", "function round1("]
    .forEach((m) => {
      if (!hub.includes(m)) problems.push("в buh_hub.html пропала метка «" + m + "», от неё зависит test-headcount.js");
    });
}

// Абсолютные пути с машины разработчика: локально работают, на GitHub — нет.
// Один такой путь в test.js уже держал проверки красными; больше не повторяем.
fs.readdirSync(__dirname).filter((f) => f.endsWith(".js")).forEach((f) => {
  const src = fs.readFileSync(__dirname + "/" + f, "utf8");
  const m = src.match(/["'][a-zA-Z]:[/\\][^"']*["']/);
  if (m) problems.push("в " + f + " абсолютный путь " + m[0] + " — на другой машине его нет, используйте __dirname");
});

if (problems.length) {
  console.log("НАСТРОЙКИ СЛОМАНЫ:");
  problems.forEach((p) => console.log("  - " + p));
  process.exit(1);
}
console.log("Блок настроек корректен, метки для тестов на месте.");
