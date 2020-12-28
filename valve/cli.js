const minimist = require("minimist");
const valve = require("./valve.js");

/** Print help message for CLI. */
function printHelp() {
  console.log(`usage: node valve [-h] [-d DISTINCT] [-r ROW_START] -o OUTPUT paths [paths ...]

positional arguments:
  paths                 Paths to input directories and/or files

optional arguments:
  -h, --help            show this help message and exit
  -d DISTINCT, --distinct DISTINCT
                        Collect each distinct error messages and write to a
                        table in provided directory
  -r ROW_START, --row-start ROW_START
                        Index of first row in tables to validate
  -o OUTPUT, --output OUTPUT
                        CSV or TSV to write error messages to`);
  process.exit(0);
}

var args = minimist(process.argv.slice(2), {
  alias: {
    d: "distinct",
    h: "help",
    o: "output",
    r: "row-start",
  },
  default: {
    r: 2,
  },
});

if (args.h) printHelp();

let inputs = args._;
if (inputs.length < 1) {
  console.error("ERROR: One or more inputs are required");
  process.exit(1);
}

let output = args.o;
if (!output) {
  console.error("ERROR: An output is required");
  process.exit(1);
}

let rowStart = args.r;
if (typeof rowStart !== "number") {
  console.error("ERROR: -r/--row-start must be a number");
  process.exit(1);
}

let distinct = args.d;
if (distinct) {
  if (fs.existsSync(distinct) && !fs.lstatSync(distinct).isDirectory()) {
    console.error(
      `ERROR: -d/--distinct '${distinct}' already exists but is not a directory`
    );
    process.exit(1);
  } else if (!fs.existsSync(distinct)) {
    fs.mkdirSync(distinct);
  }
}

valve.valve(inputs, distinct, rowStart);
