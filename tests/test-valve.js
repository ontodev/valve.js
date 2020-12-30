const fs = require("fs");
const valve = require("../src/valve.js");

/** Compare two lists of rows. */
function compareRows(actual, expected) {
  if (actual.length !== expected.length) {
    console.log(`Actual has ${actual.length} rows, but ${expected.length} were expected`);
    return false;
  }
  for (i = 0; i < actual.length; i++) {
    let actualRow = actual[i];
    let expectedRow = expected[i];
    let actualKeys = Array.from(Object.keys(actualRow));
    let expectedKeys = Array.from(Object.keys(expectedRow));
    if (JSON.stringify(actualKeys.sort()) !== JSON.stringify(expectedKeys.sort())) {
      console.log(`Actual keys were '${actualKeys.join(", ")}', but '${expectedKeys.join(", ")}' was expected`);
      return false;
    }
    for (let ek of expectedKeys) {
      if (actualRow[ek] === undefined) {
        console.log(`ERROR: Missing value '${ek}'`);
        console.log("Actual row:");
        console.log(actualRow);
        console.log("Expected row:");
        console.log(expectedRow);
        return false;
      }
      if (actualRow[ek] !== expectedRow[ek]) {
        console.log(`ERROR: Different value for '${ek}'`);
        console.log("Actual row:");
        console.log(actualRow);
        console.log("Expected row:");
        console.log(expectedRow);
        return false;
      }
    }
  }
  return true;
}

(async function () {
  // All errors
  let actualMessages = await valve.validate(["tests/inputs"]);
  let expectedMessages = await valve.getRows("tests/errors.tsv", "\t");
  actualMessages = actualMessages.sort((a, b) => {
    let aKey = `${a.table}:${a.cell}`;
    let bKey = `${b.table}:${b.cell}`;
    return (aKey > bKey) ? 1 : -1;
  });
  expectedMessages = expectedMessages.sort((a, b) => {
    let aKey = `${a.table}:${a.cell}`;
    let bKey = `${b.table}:${b.cell}`;
    return (aKey > bKey) ? 1 : -1;
  });

  let success = true;
  if (!compareRows(actualMessages, expectedMessages)) {
    success = false;
  }

  // Distinct errors
  if (!fs.existsSync("build/distinct/")) {
    fs.mkdirSync("build/distinct");
  }

  actualMessages = await valve.validate(["tests/inputs"], "build/distinct");
  expectedMessages = await valve.getRows("tests/errors_distinct.tsv", "\t");
  actualMessages = actualMessages.sort((a, b) => {
    let aKey = `${a.table}:${a.cell}`;
    let bKey = `${b.table}:${b.cell}`;
    return (aKey > bKey) ? 1 : -1;
  });
  expectedMessages = expectedMessages.sort((a, b) => {
    let aKey = `${a.table}:${a.cell}`;
    let bKey = `${b.table}:${b.cell}`;
    return (aKey > bKey) ? 1 : -1;
  });

  if (!compareRows(actualMessages, expectedMessages)) {
    success = false;
  }

  if (!success) {
    process.exit(1);
  }
  console.log("All tests passed!");
})();
