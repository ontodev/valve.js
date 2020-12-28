const fastcsv = require("fast-csv");
const fs = require("fs");
const grammar = require("./valve_grammar.js");
const jsonschema = require("jsonschema");
const nearley = require("nearley");
const path = require("path");

// Set up schemas for validating config files
const mainSchema = require("./resources/valve.json");
delete mainSchema.type;
var argumentSchema = deepCopy(mainSchema);
argumentSchema.items = { $ref: "#/definitions/argument" };
var datatypeSchema = deepCopy(mainSchema);
datatypeSchema.items = { $ref: "#/definitions/datatype" };
var fieldSchema = deepCopy(mainSchema);
fieldSchema.items = { $ref: "#/definitions/field" };
var ruleSchema = deepCopy(mainSchema);
ruleSchema.items = { $ref: "#/definitions/rule" };

// Check conditions for config tables
var datatypeConditions = [
  ["datatype", "datatype_label"],
  ["parent", "any(blank, in(datatype.datatype))"],
  ["match", "any(blank, regex)"],
  ["level", 'any(blank, in("ERROR", "error", "WARN", "warn", "INFO", "info"))'],
  ["replace", "any(blank, regex_sub)"],
];
var fieldConditions = [
  ["table", "not(blank)"],
  ["column", "not(blank)"],
  ["condition", "not(blank)"],
];
var ruleConditions = [
  ["table", "not(blank)"],
  ["when column", "not(blank)"],
  ["when condition", "not(blank)"],
  ["then column", "not(blank)"],
  ["then condition", "not(blank)"],
  ["level", 'any(blank, in("ERROR", "error", "WARN", "warn", "INFO", "info"))'],
];

// Defaults for conditions
var defaultDatatypes = {
  blank: {
    datatype: "blank",
    parent: "",
    match: /^$/,
    level: "ERROR",
    description: "an empty string",
  },
  datatype_label: {
    datatype: "datatype_label",
    parent: "",
    match: /[A-Za-z][A-Za-z0-9_-]+/,
    level: "ERROR",
    description:
      "a word that starts with a letter and may contain dashes and underscores",
  },
  regex: {
    datatype: "regex",
    parent: "",
    match: /^\/.+\/$/,
    level: "ERROR",
    description: "A regex match",
  },
  regex_sub: {
    datatype: "regex_sub",
    parent: "",
    match: /^s\/.+[^\\]|.*(?<!\/)\/.*[^\\]\/.+[^\\]|.*(?<!\/)\/.*[^\\]\/.*$/,
    level: "ERROR",
    description: "A regex substitution",
  },
};
var defaultFunctions = {
  any: {
    usage: "any(expression+)",
    check: ["expression+"],
    validate: validateAny,
  },
  concat: {
    usage: "concat(value+)",
    check: ["(expression or string)+"],
    validate: validateConcat,
  },
  distinct: {
    usage: "distinct(expression)",
    check: ["expression", "field*"],
    validate: validateDistinct,
  },
  in: {
    usage: "in(value+)",
    check: ["(string or field)+"],
    validate: validateIn,
  },
  list: {
    usage: "list(str, expression)",
    check: ["string", "expression"],
    validate: validateList,
  },
  lookup: {
    usage: "lookup(table, column, column)",
    check: checkLookup,
    validate: validateLookup,
  },
  not: {
    usage: "not(expression)",
    check: ["expression"],
    validate: validateNot,
  },
  sub: {
    usage: "sub(regex, expression)",
    check: ["regex_sub", "expression"],
    validate: validateSub,
  },
  tree: {
    usage: "tree(column, [treename, named=bool])",
    check: ["column", "tree?", "named:split?"],
    validate: null,
  },
  under: {
    usage: "under(treename, str, [direct=bool])",
    check: ["tree", "string", "named:direct?"],
    validate: validateUnder,
  },
};

/** Run VALVE validation over a list of paths. */
async function validate(
  paths,
  distinctMessages = null,
  rowStart = 2,
  addFunctions = null
) {
  // Register functions
  let defaultFunctionNames = deepCopy(Object.keys(defaultFunctions));
  let functions = defaultFunctions;
  if (addFunctions) {
    if (typeof addFunctions !== "object") {
      throw "Value for addFunctions must be an object";
    }
    for (var functName in addFunctions) {
      // Throw error on any problem
      checkCustomFunction(
        defaultFunctionNames,
        functName,
        addFunctions[functName]
      );
    }
    functions = Object.assign(functions, addFunctions);
  }

  // Check for directories and list their entire contents
  let fixedPaths = getInputPaths(paths);

  // Load all tables, error on duplicates
  let tableDetails = await getTableDetails(fixedPaths, (rowStart = rowStart));
  let config = {
    functions: functions,
    tableDetails: tableDetails,
    rowStart: rowStart,
  };

  // Load datatype, field, and rule - stop process on any problem
  let setupMessages = configureDatatypes(config)
    .concat(configureFields(config))
    .concat(configureRules(config));
  let killMessages = setupMessages.filter((m) => {
    return m.table === "datatype" || m.table === "field" || m.table === "rule";
  });
  if (killMessages.length > 0) {
    console.error("ERROR: VALVE configuration failed! See output for details.");
    return setupMessages;
  }

  // Run validation
  let messages = [];
  for (var table in tableDetails) {
    if (["datatype", "field", "rule"].indexOf(table) >= 0) {
      continue;
    }

    // Validate and return messages
    let addMessages = setupMessages
      .filter((m) => {
        return m.table === table;
      })
      .concat(validateTable(config, table));

    if (addMessages.length > 0 && distinctMessages) {
      // Update messages to only distinct in a new table
      tablePath = tableDetails[table].path;
      let distinct = await collectDistinctMessages(
        tableDetails,
        distinctMessages,
        tablePath,
        addMessages
      );
      messages = messages.concat(distinct);
    } else {
      messages = messages.concat(addMessages);
    }
  }
  return messages;
}

/** Run VALVE validation on a table. */
function validateTable(config, table) {
  let errors = [];
  let tableName = path.basename(table, path.extname(table));
  let tableDetails = config.tableDetails;

  let fields = config.tableFields[tableName]
    ? config.tableFields[tableName]
    : {};
  Object.assign(fields, config.tableFields["*"] ? config.tableFields["*"] : {});
  let rules = null;
  if (config.tableRules) {
    rules = config.tableRules[tableName] ? config.tableRules[tableName] : {};
    Object.assign(rules, config.tableRules["*"] ? config.tableRules["*"] : {});
  }

  let rowIdx = 0;
  tableDetails[tableName].rows.forEach((row) => {
    let colIdx = 1;
    Object.keys(row).forEach((field) => {
      let value = row[field];
      if (!value) {
        value = "";
      }

      // Check for fields
      if (fields[field]) {
        // Get the expected field type
        let parsedType = fields[field].parsed;
        // All values in this field must match the type
        let messages = validateCondition(
          config,
          parsedType,
          tableName,
          field,
          rowIdx,
          value
        );
        if (messages.length > 0) {
          let fieldID = fields[field].fieldID;
          messages.forEach((m) => {
            m["rule ID"] = "field:" + fieldID;
            if (!m.level) {
              m.level = "ERROR";
            }
            errors.push(m);
          });
        }
      }

      // Check for rules
      if (rules && rules[field]) {
        rules[field].forEach((rule) => {
          let whenCondition = rule.whenCondition;
          let messages = validateCondition(
            config,
            whenCondition,
            tableName,
            field,
            rowIdx,
            value
          );
          if (messages.length === 0) {
            // The "when" value meets the condition - validate the "then" value
            let thenColumn = rule.column;
            let thenValue = row[thenColumn];
            messages = validateCondition(
              config,
              rule.thenCondition,
              tableName,
              thenColumn,
              rowIdx,
              thenValue
            );
            if (messages.length > 0) {
              messages.forEach((m) => {
                let msg =
                  `because '${value}' is '${parsedToString(whenCondition)}', ` +
                  m.message;
                m.message = msg;
                m.rule = rule.message;
                m["rule ID"] = "rule:" + rule.ruleID;
                if (!m.level) {
                  m.level = "ERROR";
                }
                errors.push(m);
              });
            }
          }
        });
      }
      colIdx++;
    });
    rowIdx++;
  });
  return errors;
}

// ---------- CONFIGURATION ----------

/** Build a parsed condition from a condition string. Throw error if it cannot be */
function buildCondition(config, table, column, condition) {
  let parsed = parse(condition);
  let err = checkCondition(config, table, column, condition, parsed);
  if (err) {
    throw err;
  }
  return parsed;
}

/** Build a hierarchy for the 'tree' function while validating the values. */
function buildTree(config, fnRowIdx, args, table, column) {
  let errors = [];
  let tableDetails = config.tableDetails;
  let rowStart = config.rowStart;
  let rows = tableDetails[table].rows;
  let colIdx = tableDetails[table].fields.indexOf(column);
  let trees = config.trees ? config.trees : {};

  // First arg is child column
  let childColumn = args[0].value;

  // Parse the rest of the args
  let splitChar = null;
  let addTreeName = null;
  let i = 1;
  while (i < args.length) {
    let arg = args[i];
    if (arg.name && arg.name === "split") {
      splitChar = arg.value;
    } else if (arg.table) {
      addTreeName = `${arg.table}.${arg.column}`;
    } else {
      errors.push(
        `'tree' argument ${x + 1} must be table.column pair or split=CHAR`
      );
    }
  }

  // Maybe add an already-built tree
  let tree = {};
  if (addTreeName) {
    tree = trees[addTreeName];
    if (!tree) {
      errors.push({
        message: addTreeName + " must be defined before using in a function",
      });
      return errors;
    }
  }

  // Validate values and build tree
  let allowedValues = Object.keys(tree);
  rows.forEach((row) => {
    allowedValues.push(row[childColumn]);
  });
  let rowIdx = rowStart;
  rows.forEach((row) => {
    let parent = row[column];
    let child = row[childColumn];
    if (!parent || parent.trim() === "") {
      if (!tree[child]) {
        tree[child] = new Set();
      }
      rowIdx++;
      return;
    }
    let parents = [parent];
    if (splitChar) {
      parents = parent.split(splitChar);
    }
    parents.forEach((parent) => {
      if (allowedValues.indexOf(parent) < 0) {
        let msg = `'${parent}' from ${table}.${column} must exist in ${table}.${childColumn}`;
        if (addTreeName) {
          msg += ` or ${addTreeName} tree`;
        }
        errors.push({
          table: table,
          cell: idxToA1(rowIdx, colIdx + 1),
          rule: "",
          "rule ID": "field:" + fnRowIdx,
          level: "ERROR",
          message: msg,
          suggestion: ""
        });
      }
      if (!tree[child]) {
        tree[child] = new Set();
      }
      tree[child].add(parent);
    });
    rowIdx++;
  });

  // Add this tree to config
  config.trees[`${table}.${column}`] = tree;
  return errors;
}

/** Check the rows of a configuration table. */
function checkConfigContents(config, table, conditions, rows) {
  let messages = [];
  let parsedConditions = [];
  conditions.forEach((pair) => {
    let column = pair[0];
    let condition = pair[1];
    parsedConditions.push([
      column,
      buildCondition(config, table, column, condition),
    ]);
  });
  let rowIdx = config.rowStart;
  rows.forEach((row) => {
    parsedConditions.forEach((pair) => {
      let column = pair[0];
      let condition = pair[1];
      let value = row[column];
      if (!value || value.trim() === "") {
        return;
      }
      let addMsg = validateCondition(
        config,
        condition,
        table,
        column,
        rowIdx,
        value
      );
      if (addMsg) {
        messages = messages.concat(addMsg);
      }
      rowIdx++;
    });
  });
  return messages;
}

/** Add datatypes to config. */
function configureDatatypes(config) {
  if (!config.tableDetails.datatype) {
    throw "missing table 'datatype'";
  }
  let rows = config.tableDetails.datatype.rows;

  // Check structure & contents of datatype table
  let messages = checkRows(config, datatypeSchema, "datatype", rows);
  if (messages.length > 0) {
    return messages;
  }
  config.datatypes = defaultDatatypes;
  messages = checkConfigContents(config, "datatype", datatypeConditions, rows);
  if (messages.length > 0) {
    return messages;
  }

  // Add datatypes to config
  rows.forEach((row) => {
    let dt = row.datatype;
    if (dt !== null && dt.trim() !== "") {
      let match = row.match;
      if (match && match.trim() !== "") {
        let pattern = /\/(.+)\//;
        row.match = new RegExp(pattern.exec(match)[1]);
      }
      config.datatypes[dt] = row;
    }
  });

  return messages;
}

/** Add fields to config. */
function configureFields(config) {
  if (!config.tableDetails.hasOwnProperty("field")) {
    throw "missing table 'field'";
  }
  rows = config.tableDetails.field.rows;

  // Check structure & contents of field
  let messages = checkRows(config, fieldSchema, "field", rows);
  if (messages.length > 0) return messages;
  messages = checkConfigContents(config, "field", fieldConditions, rows);
  if (messages.length > 0) return messages;

  config.trees = {};
  config.tableFields = {};
  let rowIdx = config.rowStart - 1;
  rows.forEach((row) => {
    rowIdx++;
    let table = row.table;
    let column = row.column;
    let fieldTypes = config.tableFields[table] ? config.tableFields[table] : {};
    if (table !== "*") {
      if (!config.tableDetails[table]) {
        messages.push(
          error(
            config,
            "field",
            "table",
            rowIdx,
            `unrecognized table '${table}'`
          )
        );
        return;
      }
      if (config.tableDetails[table].fields.indexOf(column) < 0) {
        messages.push(
          error(
            config,
            "field",
            "column",
            rowIdx,
            `unrecognized column '${column}' for table '${table}'`
          )
        );
        return;
      }
    }
    // Check that this table.column has not already been defined
    if (fieldTypes[column]) {
      messages.push(
        error(
          config,
          "field",
          "column",
          rowIdx,
          `multiple conditions defined for ${table}.${column}`
        )
      );
      return;
    }

    // Parse and validate this row
    let condition = row.condition;
    let parsed = parse(condition);
    let err = checkCondition(config, table, column, condition, parsed);
    if (err) {
      messages.push(error(config, "field", "condition", rowIdx, err));
      return;
    }

    if (parsed.type === "function" && parsed.name === "tree") {
      // Build a tree and add it to config
      let treeErrors = buildTree(config, rowIdx, parsed.args, table, column);
      if (treeErrors.length > 0) {
        messages = messages.concat(treeErrors);
      }
    } else {
      // Otherwise add it to tableFields
      fieldTypes[column] = { parsed: parsed, fieldID: rowIdx };
      config.tableFields[table] = fieldTypes;
    }
  });
  return messages;
}

/** Add rules to config. */
function configureRules(config) {
  if (!config.tableDetails.rule) {
    // Rule table is optional
    return [];
  }
  let rows = config.tableDetails.rule.rows;

  // Check structure & contents of rule table
  let messages = checkRows(config, ruleSchema, "rule", rows);
  if (messages.length > 0) {
    return messages;
  }
  messages = checkConfigContents(config, "rule", ruleConditions, rows);
  if (messages.length > 0) {
    return messages;
  }

  config.tableRules = {};
  let rowIdx = config.rowStart - 1;
  rows.forEach((row) => {
    rowIdx++;
    let table = row.table;
    if (!config.tableDetails[table]) {
      messages.push(
        error(config, "rule", "table", rowIdx, `unrecognized table '${table}'`)
      );
      return;
    }
    let columnRules = config.tableRules[table] ? config.tableRules[table] : {};
    let whenColumn = row["when column"];
    if (config.tableDetails[table].fields.indexOf(whenColumn) < 0) {
      messages.push(
        error(
          config,
          "rule",
          "when column",
          rowIdx,
          `unrecognize column '${whenColumn}' for table '${table}'`
        )
      );
      return;
    }

    let rules = columnRules[whenColumn] ? columnRules[whenColumn] : [];
    let thenColumn = row["then column"];
    if (config.tableDetails[table].fields.indexOf(thenColumn) < 0) {
      messages.push(
        error(
          config,
          "rule",
          "then column",
          rowIdx,
          `unrecognize column '${thenColumn}' for table '${table}'`
        )
      );
      return;
    }

    // Parse and validate the conditions
    let whenCondition = row["when condition"];
    let parsedWhenCondition = parse(whenCondition);
    let whenCondErr = checkCondition(
      config,
      table,
      whenColumn,
      whenCondition,
      parsedWhenCondition
    );
    if (whenCondErr) {
      messages.push(
        error(config, "rule", "when condition", rowIdx, whenCondErr)
      );
      return;
    }
    let thenCondition = row["then condition"];
    let parsedThenCondition = parse(thenCondition);
    let thenCondErr = checkCondition(
      config,
      table,
      thenColumn,
      thenCondition,
      parsedThenCondition
    );
    if (thenCondErr) {
      messages.push(
        error(config, "rule", "then condition", rowIdx, thenCondErr)
      );
      return;
    }

    // Add the condition
    rules.push({
      whenCondition: parsedWhenCondition,
      column: thenColumn,
      thenCondition: parsedThenCondition,
      level: row.level ? row.level : "ERROR",
      message: row.description ? row.description : null,
      ruleID: rowIdx,
    });
    columnRules[whenColumn] = rules;
    config.tableRules[table] = columnRules;
  });
  return messages;
}

/**
 * Build an object containing table details from all inputs.
 */
async function getTableDetails(paths, rowStart = 2) {
  let tables = {};
  for (var i = 0; i < paths.length; i++) {
    let p = paths[i];
    let sep = p.endsWith(".csv") ? "," : "\t";
    let name = path.basename(p, path.extname(p));
    let rows = await getRows(p, sep);
    let fields = new Set();
    rows.forEach((r) => {
      Object.keys(r).forEach((k) => fields.add(k));
    });
    tables[name] = { path: p, fields: Array.from(fields), rows: rows };
  }
  return tables;
}

// ---------- CHECKS ----------

/**
 * Check a custom function. Throw error on any problem.
 */
function checkCustomFunction(defaultNames, functName, details) {
  if (!details.hasOwnProperty("validate")) {
    throw `Dict entry for '${functName}' requires a 'validate' key`;
  }
  if (defaultNames.indexOf(functName) >= 0) {
    throw `Cannot use builtin function name '${functName}'`;
  }
  let fn = details.validate;
  let fnStr = fn.toString();
  let params = fnStr
    .slice(fnStr.indexOf("(") + 1, fnStr.indexOf(")"))
    .match(/([^\s,]+)/g);
  if (params.length != 6) {
    throw `'${functName}' must have 6 parameters`;
  }
  if (params[0] !== "config") {
    throw `'${functName}' argument 1 must be 'config'`;
  }
  if (params[1] !== "args") {
    throw `'${functName}' argument 2 must be 'args'`;
  }
  if (params[2] !== "table") {
    throw `'${functName}' argument 3 must be 'table'`;
  }
  if (params[3] !== "column") {
    throw `'${functName}' argument 4 must be 'column'`;
  }
  if (params[4] !== "rowIdx") {
    throw `'${functName}' argument 5 must be 'rowIdx'`;
  }
  if (params[5] !== "value") {
    throw `'${functName}' argument 6 must be 'value'`;
  }
}

/**
 * Check a function.
 * Return an error message on error or nothing on success.
 */
function checkFunction(config, table, column, parsed) {
  let condition = parsedToString(parsed);
  let name = parsed.name;
  if (!config.functions[name]) {
    return `unrecognized function '${name}'`;
  }
  let fn = config.functions[name];
  let v = new jsonschema.Validator();
  let res = v.validate(parsed.args, argumentSchema);
  if (!res.valid) {
    return res.errors.reduce(function (str, err) {
      let msg = err.message;
      if (err.schema == "oneOf") {
        let pos = err.path[0] + 1;
        let instance = parsedToString(err.instance);
        instance = instance ? instance : err.instance;
        msg = `arugment ${position} '${instance}' is not one of the allowed types for ${name} in '${condition}'`;
      }
      return str + "; " + e.message;
    });
  }
  parsed.args.forEach((arg) => {
    if (arg.type === "function") {
      let err = checkFunction(config, table, column, arg);
      if (err) {
        return err;
      }
    } else if (arg.type === "field") {
      let t = arg.table;
      if (!config.tableDetails.hasOwnProperty(t)) {
        return `unrecognized table '${t}'`;
      }
      let c = arg.column;
      if (!config.tableDetails[t].hasOwnProperty(c)) {
        return `unrecognized column '${c}' in table '${t}'`;
      }
    }
  });
  if (fn.check) {
    let c = fn.check;
    if (typeof c === "function") {
      return c(config, table, column, parsed.args);
    } else if (typeof c === "object") {
      return checkArgs(config, table, name, parsed.args, fn.check);
    } else {
      throw `'check' value for ${name} must be a list or function`;
    }
  }
}

/** Check a list of args for a function against of expected types. */
function checkArgs(config, table, name, args, expected) {
  let i = 0;
  let errors = [];
  function* gen() {
    yield* expected;
  }
  let itr = gen();
  let e = itr.next().value;
  let addMsg = "";
  while (true) {
    if (e.endsWith("*")) {
      // zero or more
      e = e.slice(0, -1);
      for (let a of args.slice(i)) {
        let err = checkArg(config, table, a, e);
        if (err) {
          errors.push(`optional argument ${i + 1} ${err}${addMsg}`);
        }
        i++;
      }
    } else if (e.endsWith("?")) {
      // zero or one
      e = e.slice(0, -1);
      if (args.length <= i) {
        // this is OK here
        break;
      }
      let err = checkArg(config, table, args[i], e);
      if (err) {
        let addMsg = ` or ${e}`;
        e = itr.next();
        if (e.done) {
          // no other expected args, add error
          errors.push(`optional argument ${i + 1} ${err}${addMsg}`);
          break;
        }
        e = e.value;
        continue;
      }
    } else if (e.endsWith("+")) {
      // one or more
      e = e.slice(0, -1);
      if (args.length <= i) {
        errors.push(`requires one or more '${e}' at arguement ${i + 1}`);
        break;
      }
      for (let a of args.slice(i)) {
        let err = checkArg(config, table, a, e);
        if (err) {
          errors.push(`argument ${i + 1} ${err}${addMsg}`);
        }
        i++;
      }
    } else {
      // exactly one
      if (args.length <= i) {
        errors.push(`requires one '${e}' at argument '${i + 1}'`);
        break;
      }
      let err = checkArg(config, table, args[i], e);
      if (err) {
        errors.push(`argument ${i + 1} ${err}${addMsg}`);
      }
    }
    i++;
    e = itr.next();
    if (e.done) {
      break;
    }
    e = e.value;
  }
  if (i < args.length) {
    errors.push(`expects ${i} arguments, but ${args.length} were given`);
  }
  if (errors.length > 0) {
    return name + " " + errors.join("; ");
  }
}

/** Check that an arg is of expected type. */
function checkArg(config, table, arg, expected) {
  if (expected.includes(" or ")) {
    // Remove optional parentheses
    let match = /\((.+)\)/.exec(expected);
    expected = match ? match[1] : expected;
    let errors = [];
    let valid = false;
    expected.split(" or ").forEach((e) => {
      let err = checkArg(config, table, arg, e);
      if (!err) {
        valid = true;
      } else {
        errors.push(err);
      }
    });
    if (!valid) {
      return errors.join(" or ");
    }
  } else if (expected.startsWith("named:")) {
    let narg = expected.slice(6);
    if (arg.type !== "named_arg")
      return `value must be a named argument '${narg}'`;
    if (arg.key !== expected) return `named argument must be '${narg}'`;
  } else {
    switch (expected) {
      case "column":
        if (arg.type !== "string") {
          return `value must be a string representing a column in '${table}'`;
        }
        if (config.tableDetails[table].fields.indexOf(arg.value) < 0) {
          return `'${arg.value}' must be a column in '${table}'`;
        }
        break;
      case "expression":
        if (arg.type !== "function" && arg.type !== "string") {
          return "value must be a function or datatype";
        }
        if (arg.type === "string" && !config.datatypes[arg.value]) {
          return `'${arg.value}' must be a defined datatype`;
        }
        break;
      case "field":
        if (arg.type !== "field")
          return "value must be a field (table.column pair)";
        break;
      case "regex_sub":
        if (arg.type !== "regex") return "value must be a regex pattern";
        if (!arg.replace) return "regex pattern requries a substitution";
        break;
      case "regex_match":
        if (arg.type !== "regex") return "value must be a regex pattern";
        if (arg.replace) return "regex pattern should not have a substitution";
        break;
      case "string":
        if (arg.type !== "string") return "value must be a string";
        break;
      case "tree":
        if (arg.type !== "field") {
          return "value must be a table-column pair representing a tree name";
        }
        let tName = `${arg.table}.${arg.column}`;
        if (!config.trees[tName]) return tName + " must be a defined tree";
        break;
      default:
        throw "unknown argument type: " + expected;
    }
  }
}

/** Check the arguments passed to the lookup function. */
function checkLookup(config, table, column, args) {
  let errors = [];
  let i = 0;
  let targetTable = null;
  while (i < 3 && i < args.length) {
    let a = args[i];
    i++;
    if (a.type !== "string") {
      errors.push(`argument ${i} must be of type string`);
      return;
    }
    if (i === 1) {
      targetTable = a.value;
      if (!config.tableDetails[targetTable]) {
        errors.push("argument 1 must be a table in inputs");
        break;
      }
    }
    if (
      targetTable &&
      i > 1 &&
      config.tableDetails[targetTable].fields.indexOf(a.value) < 0
    ) {
      errors.push(`argument ${i} must be a column in '${targetTable}'`);
    }
  }
  if (args.length !== 3) {
    errors.push(`expects 3 arguments, but ${args.length} were given`);
  }
  if (errors.length > 0) {
    return "lookup " + errors.join("; ");
  }
}

/** Check the rows of a configuration file based on a JSON schema. */
function checkRows(config, schema, table, rows) {
  let errors = [];
  let v = new jsonschema.Validator();
  let res = v.validate(rows, schema);
  if (!res.valid) {
    res.errors.forEach((err) => {
      let msg = err.message;
      if (err.schema === "required") {
        msg = err.message.replace("property", "column");
      }
      if (err.path.length > 1) {
        let rowIdx = err.path[0];
        let column = err.path[1];
        errors.push(error(config, table, column, rowIdx, msg));
      } else {
        errors.push({ table: table, level: "ERROR", message: msg });
      }
    });
  }
  return errors;
}

/** Recursively build a list of ancestor datatypes for a given datatype. */
function findDatatypeAncestors(datatypes, datatype) {
  let ancestors = [];
  let parent = datatypes[datatype].parent;
  if (parent) {
    ancestors.push(parent);
    ancestors = ancestors.concat(findDatatypeAncestors(datatypes, parent));
  }
  return ancestors;
}

/** Parse and check a condition. */
function checkCondition(config, table, column, condition, parsed) {
  if (parsed.type === "function") {
    return checkFunction(config, table, column, parsed);
  } else if (parsed.type === "string") {
    let name = parsed.value;
    if (!config.datatypes[name]) {
      return `unrecognized datatype '${name}'`;
    }
  } else {
    return `invalid condition '${condition}'`;
  }
}

// --------- CONDITION VALIDATION ----------

/** Run validation for a condition on a value. */
function validateCondition(config, condition, table, column, rowIdx, value) {
  if (condition.type === "function") {
    let name = condition.name;
    let args = condition.args;
    let fn = config.functions[name];
    return fn.validate(config, args, table, column, rowIdx, value);
  } else if (condition.type === "string") {
    let msg = validateDatatype(config, condition, table, column, rowIdx, value);
    return msg;
  } else {
    throw "Invalid condition: " + condition;
  }
}

/** Determine if the value is of datatype. */
function validateDatatype(config, condition, table, column, rowIdx, value) {
  let datatypes = config.datatypes;
  let name = condition.value;
  let ancestors = findDatatypeAncestors(datatypes, name);
  ancestors.unshift(name);
  let errors = [];
  ancestors.forEach((name) => {
    let datatype = datatypes[name];
    let description = datatype.description ? datatype.description : name;
    let level = datatype.level ? datatype.level : "ERROR";
    if (datatype.match) {
      let pattern = datatype.match;
      let res = pattern.exec(value);
      if (!res) {
        let suggestion = null;
        if (datatype.replace) {
          let pattern = /s\/(.+[^\\]|.*(?<!\/)\/.*[^\\])\/(.+[^\\]|.*(?<!\/)\/.*[^\\])\/(.*)/;
          let subRes = pattern.exec(datatype.replace);
          pattern = new RegExp(subRes[0]);
          suggestion = value.replace(pattern, subRes[1]);
        }
        errors.push(
          error(
            config,
            table,
            column,
            rowIdx,
            description,
            (suggestion = suggestion),
            (level = level)
          )
        );
      }
    }
  });
  return errors;
}

// ---------- VALVE FUNCTIONS ----------

/** Method for the VALVE 'any' function. */
function validateAny(config, args, table, column, rowIdx, value) {
  let conditions = [];
  for (let arg of args) {
    let messages = validateCondition(config, arg, table, column, rowIdx, value);
    if (messages.length === 0) {
      // As long as one is met, this passes
      return [];
    }
    conditions.push(parsedToString(arg));
  }
  // If we get here, no condition was met
  let message = `'${value}' must meet one of: ${conditions.join(", ")}`;
  return [error(config, table, column, rowIdx, message)];
}

/** Method for the VALVE 'concat' function. */
function validateConcat(config, args, table, column, rowIdx, value) {
  let datatypes = config.datatypes;
  let validateConditions = [];
  let validateValues = [];
  let rem = value;
  for (let arg of args) {
    if (arg.type === "string") {
      if (datatypes[arg.value]) {
        validateConditions.push(arg);
        continue;
      }
      if (!value.includes(arg.value)) {
        let msg = `'${value}' must contain substring '${arg.value}'`;
        return [error(config, table, column, rowIdx, msg)];
      }
      validateValues.push(rem.split(arg.value)[0]);
      rem = rem.split(arg.value).slice(1).join(arg.value);
    } else {
      validateConditions.push(arg);
    }
  }
  if (rem !== "") {
    validateValues.push(rem);
  }
  let idx = 0;
  let messages = [];
  while (idx < validateValues.length) {
    let v = validateValues[idx];
    let condition = validateConditions[idx];
    messages = messages.concat(
      validateCondition(config, condition, table, column, rowIdx, v)
    );
    idx++;
  }
  return messages;
}

/** Get all indexes of an item in an array. */
function getIndexes(arr, item) {
  var idxs = [];
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] === item) idxs.push(i);
  }
  return idxs;
}

/** Method for the VALVE 'distinct' function. */
function validateDistinct(config, args, table, column, rowIdx, value) {
  let baseRows = config.tableDetails[table].rows;
  let baseHeaders = config.tableDetails[table].fields;
  let baseValues = baseRows.map((row) => row[column]).filter((x) => x);

  let duplicateLocs = new Set();
  let valueIndexes = getIndexes(baseValues, value);
  if (valueIndexes.length > 1) {
    let colIdx = baseHeaders.indexOf(column) + 1;
    valueIndexes.forEach((idx) => {
      if (idx !== rowIdx)
        duplicateLocs.add(`${table}:${idxToA1(idx + config.rowStart, colIdx)}`);
    });
  }

  // Extra table.columns to check
  if (args.length > 1) {
    args.slice(1).forEach((arg) => {
      let t = arg.table;
      let c = arg.column;
      let tRows = config.tableDetails[t].rows;
      let tHeaders = config.tableDetails[t].fields;
      let tValues = tRows.map((row) => row[column]).filter((x) => x);
      tValueIndexes = getIndexes(tValues, value);
      if (tValueIndexes > 0) {
        let colIdx = tHeaders.indexOf(c) + 1;
        valueIndexes.forEach((idx) => {
          duplicateLocs.add(`${table}:${idxToA1(idx + rowStart, colIdx)}`);
        });
      }
    });
  }

  duplicateLocs = Array.from(duplicateLocs);
  if (duplicateLocs.length > 0) {
    let msg = `'${value}' must be distinct with value(s) at: ${duplicateLocs.join(
      ", "
    )}`;
    return [error(config, table, column, rowIdx, msg)];
  }
  return [];
}

/** Method for the VALVE 'in' function. */
function validateIn(config, args, table, column, rowIdx, value) {
  let allowed = [];
  for (let arg of args) {
    if (arg.type === "string") {
      if (value === arg.value) {
        return [];
      }
      allowed.push(`"${arg.value}"`);
    } else {
      let columnName = arg.column;
      let sourceRows = config.tableDetails[arg.table].rows;
      let allowedValues = sourceRows
        .map((row) => row[columnName])
        .filter((x) => x);
      if (allowedValues.indexOf(value) >= 0) {
        return [];
      }
    }
  }
  let msg = `'${value}' must be in: ` + allowedValues.join(", ");
  return [error(config, table, column, rowIdx, msg)];
}

/** Method for the VALVE 'list' function. */
function validateList(config, args, table, column, rowIdx, value) {
  let splitChar = args[0].value;
  let expr = args[1];
  let errors = [];
  value.split(splitChar).forEach((v) => {
    errors = errors.concat(
      validateCondition(config, expr, table, column, rowIdx, v)
    );
  });
  if (errors.length > 0) {
    let messages = errors.map((e) => e.message);
    return [error(config, table, column, rowIdx, messages.join("; "))];
  }
  return [];
}

/** Method for the VALVE 'lookup' function. */
function validateLookup(config, args, table, column, rowIdx, value) {
  let tableRules = config.tableRules[table];
  let lookupValue = null;
  for (let whenColumn of Object.keys(tableRules)) {
    let rules = tableRules[whenColumn];
    for (let rule of rules) {
      if (rule.column === column && rule.thenCondition.name === "lookup") {
        lookupValue = config.tableDetails[table].rows[rowIdx][whenColumn];
        break;
      }
    }
    if (lookupValue) {
      break;
    }
  }
  if (!lookupValue) {
    throw `unable to find lookup function for ${table}.${column} in rule table`;
  }

  let searchTable = args[0].value;
  let searchColumn = args[1].value;
  let returnColumn = args[2].value;
  let searchRows = config.tableDetails[searchTable].rows;
  for (let row of searchRows) {
    let maybeValue = row[searchColumn];
    if (maybeValue === lookupValue) {
      let expected = row[returnColumn];
      if (value !== expected) {
        let msg = `'${value}' must be '${expected}'`;
        return [
          error(config, table, column, rowIdx, msg, (suggestion = expected)),
        ];
      }
      return [];
    }
  }
  let msg = `'${value}' must be present in ${searchTable}.${searchColumn}`;
  return [error(config, table, column, rowIdx, msg)];
}

/** Method for the VALVE 'not' function. */
function validateNot(config, args, table, column, rowIdx, value) {
  for (let arg of args) {
    let messages = validateCondition(config, arg, table, column, rowIdx, value);
    if (messages.length === 0) {
      // If any condition *is* met (no errors), this fails
      let unparsed = parsedToString(arg);
      let msg = `'${value}' must not be '${parsedToString(arg)}'`;
      if (unparsed === "blank") {
        msg = "value must not be blank";
      }
      return [error(config, table, column, rowIdx, msg)];
    }
  }
  return [];
}

/** Method for the VALVE 'sub' function. */
function validateSub(config, args, table, column, rowIdx, value) {
  let regex = args[0];
  let subFunct = args[1];

  // Handle any regex flags
  let flags = regex.flags;
  let pattern;
  if (flags) {
    pattern = new RegExp(regex.pattern, flags);
  } else {
    pattern = new RegExp(regex.pattern);
  }
  value = value.replace(pattern, regex.replace);
  return validateCondition(config, subFunct, table, column, rowIdx, value);
}

/** Method for the VALVE 'under' function. */
function validateUnder(config, args, table, column, rowIdx, value) {
  let treeName = `${args[0].table}.${args[0].column}`;
  if (!config.trees[treeName]) {
    throw `a tree for ${treeName} is not defined`;
  }
  let ancestor = args[1].value;
  let direct = args.length === 3 && args[2].value.toLowerCase() === "true";
  if (hasAncestor(config.trees[treeName], ancestor, value, (direct = direct))) {
    return [];
  }

  let msg = direct
    ? `'${value}' must be a direct subclass of '${ancestor}' from ${treeName}`
    : `'${value}' must be equal to or under '${ancestor}' from ${treeName}`;
  return [error(config, table, column, rowIdx, msg)];
}

// ---------- OUTPUTS ----------

/**
 * Collect distinct messages and write the rows with distinct messages to a new table.
 * The new table will be [tableName]_distinct. Return the distinct messages with updated locations.
 */
async function collectDistinctMessages(
  tableDetails,
  outputDir,
  tablePath,
  messages
) {
  let distinctMessages = {};
  messages.forEach((msg) => {
    if (!distinctMessages[msg.message]) {
      distinctMessages[msg.message] = msg;
    }
  });
  let messageRows = {};
  for (let key in distinctMessages) {
    let msg = distinctMessages[key];
    let row = msg.cell.slice(1);
    if (!messageRows[row]) {
      messageRows[row] = [];
    }
    messageRows[row].push(msg);
  }
  messages = [];

  let tableExt = path.extname(tablePath);
  let tableName = path.basename(tablePath, tableExt);
  let sep = tableExt === ".csv" ? "," : "\t";
  let output = path.join(outputDir, `${tableName}_distinct${tableExt}`);

  let fields = tableDetails[tableName].fields;
  let rows = tableDetails[tableName].rows;

  let outputRows = [];
  let rowIdx = 2;
  let newIdx = 2;
  rows.forEach((row) => {
    if (messageRows[rowIdx]) {
      outputRows.push(row);
      messageRows[rowIdx].forEach((msg) => {
        msg.table = tableName + "_distinct";
        msg.cell = msg.cell.slice(0, 1) + newIdx;
        messages.push(msg);
      });
      newIdx++;
    }
    rowIdx++;
  });

  writeTable(output, outputRows);
  return messages;
}

const CSV = require("tsv").CSV;
const TSV = require("tsv");

/** Write rows to a TSV or CSV table. */
function writeTable(output, messages) {
  if (output.endsWith(".csv")) {
    fs.writeFileSync(output, CSV.stringify(messages));
  } else {
    fs.writeFileSync(output, TSV.stringify(messages));
  }
}

// ---------- HELPERS ----------

/** Deep copy an object. */
function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** Format an error message. */
function error(
  config,
  table,
  column,
  rowIdx,
  message,
  suggestion = null,
  level = "ERROR",
) {
  let rowStart = config.rowStart;
  let colIdx = config.tableDetails[table].fields.indexOf(column);
  let rowNum;
  if (["datatype", "field", "rule"].indexOf(table) >= 0) {
    rowNum = rowIdx;
  } else {
    rowNum = rowIdx + rowStart;
  }
  return {
    table: table,
    cell: idxToA1(rowNum, colIdx + 1),
    level: level,
    message: message,
    suggestion: suggestion ? suggestion : "",
    rule: "",
    "rule ID": ""
  };
}

/** Get the file paths of all inputs, handling directories. */
function getInputPaths(paths) {
  let fixedPaths = [];
  paths.forEach((p) => {
    if (fs.lstatSync(p).isDirectory()) {
      fs.readdirSync(p).forEach((f) => {
        if (f.endsWith(".tsv") || f.endsWith(".csv")) {
          fixedPaths.push(path.join(p, f));
        }
      });
    } else {
      fixedPaths.push(p);
    }
  });
  return fixedPaths;
}

/** Get the rows from a CSV or TSV file. */
async function getRows(fileName, delimiter) {
  var queryParameter = () =>
    new Promise((resolve) => {
      let res = [];
      fastcsv
        .parseFile(fileName, { headers: true, delimiter: delimiter })
        .on("data", (data) => {
          res.push(data);
        })
        .on("end", () => {
          resolve(res);
        });
    });
  var rows = [];
  await queryParameter().then((res) => (rows = res));
  return rows;
}

/** Check whether a node has an ancestor (or is self) in a tree. */
function hasAncestor(tree, ancestor, node, direct = false) {
  if (node === ancestor && !direct) return true;
  if (!tree[node]) return false;
  let parents = Array.from(tree[node]);
  if (parents.indexOf(ancestor) >= 0) return true;
  if (direct) return false;
  for (let parent of parents) {
    if (hasAncestor(tree, ancestor, parent)) return true;
  }
  return false;
}

/** Convert a row num & col num to A1 format. */
function idxToA1(rowIdx, colIdx) {
  let div = colIdx;
  let columnLabel = "";
  while (div > 0) {
    let mod = div % 26;
    div = Math.floor(div / 26);
    if (mod === 0) {
      mod = 26;
      div -= 1;
    }
    columnLabel = String.fromCharCode(mod + 64) + columnLabel;
  }
  return columnLabel + rowIdx;
}

/** Parse a string condition using Nearley. */
function parse(condition) {
  const parser = new nearley.Parser(nearley.Grammar.fromCompiled(grammar));
  parser.feed(condition);
  return parser.results[0];
}

/** Convert a parsed condition back to its original string. */
function parsedToString(condition) {
  let condType = condition.type;
  let name;
  let val;
  switch (condType) {
    case "string":
      val = condition.value;
      if (val.includes(" ")) {
        return `"${val}"`;
      }
      return val;
    case "field":
      let table = condition.table;
      let col = condition.column;
      if (table.includes(" ")) {
        table = `"${table}"`;
      }
      if (col.includes(" ")) {
        col = `"${col}"`;
      }
      return `${table}.${col}`;
    case "named_arg":
      name = condition.name;
      val = condition.value;
      if (val.includes(" ")) {
        val = `"${val}"`;
      }
      return `${name}=${val}`;
    case "regex":
      let pattern = condition.pattern;
      let flags = condition.flags ? condition.flags : "";
      if (condition.replace) {
        return `s/${pattern}/${replace}/${flags}`;
      }
      return `/${pattern}/${flags}`;
    case "function":
      let args = [];
      condition.args.forEach((arg) => {
        args.push(parsedToString(arg));
      });
      name = condition.name;
      args = args.join(", ");
      return `${name}(${args})`;
    default:
      throw "unknown condition type: " + condType;
  }
}

async function valve(inputs, distinct, rowStart) {
  let messages = await validate(inputs, distinct, rowStart);
  writeTable(output, messages);
  if (messages.length > 0) {
    console.log("VALVE completed with " + messages.length + " problems found!");
  }
  let errMessages = messages.filter((m) => {
    return m.level && m.level.toLowerCase() === "error";
  });
  if (errMessages.length > 0) {
    process.exit(1);
  }
}

module.exports.valve = valve;
module.exports.validate = validate;
module.exports.getRows = getRows;
