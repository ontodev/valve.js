#!/usr/bin/env node

var fs = require('fs');
var opts = require('commander');
var parse = require('csv-parse/lib/sync');
var nearley = require('nearley');
var grammar = require('./valve_grammar.js');

const parser = new nearley.Parser(nearley.Grammar.fromCompiled(grammar));
var parser_column = parser.save();

var version = '0.0.1';

opts.version(version, '-v, --version')
    .arguments('<file.ne>')
    .option('-o, --out [filename.js]', 'File to output to (defaults to stdout)', false)
    .option('-e, --export [name]', 'Variable to set parser to', 'grammar')
    .option('-q, --quiet', 'Suppress linter')
    .option('--nojs', 'Do not compile postprocessors')
    .parse(process.argv);


function idx_to_a1(row, col) {
    // Convert a row & column to A1 notation. Adapted from gspread.utils.
    // :param row: row index
    // :param col: column index
    // :return: A1 notation of row:column
    var div = col;
    var column_label = "";

    while(div > 0) {
        var mod = div % 26;
        var div = Math.floor(div / 26);
        if(mod == 0) {
            mod = 26
            div -= 1
        }
        column_label = String.fromCharCode(mod + 64) + column_label
    }

    return column_label + row
}

function a1(table, column, row) {
    for(var i in headers[table]) {
        if(headers[table][i] == column) {
            return idx_to_a1(row, parseInt(i) + 1);
        }
    }
}


// Given a range, validate the first cell.
// table name, column name, row number, cell value
function validate_cell(table, column, row, value) {
  var special_tables = ['datatype', 'field', 'rule'];
  for(var i in special_tables) {
    if(special_tables[i] == table) {
      return;
    }
  }
  
  // Ignore header row.
  if(row == 0) {
    return;
  }
  
  // Get the field for the cell.
  var field = get_field(table, column);
  console.log(field.results);
  if(!field) {
    return;
  }

  var type = field.results.type;
  if(type == "") {
    return {
      level: 'ERROR',
      message: 'No datatype for ' + table + '.' + column,
    }
  }
  
  // Validate the cell's datatype.
  var result;
  if(type == 'datatype') {
    var datatype = field.results.name;
    var datatypes = get_datatypes(datatype);
    if(datatypes.length == 0) {
      return {
        level: 'ERROR',
        message: 'No such datatype: ' + datatype,
      }
    }
    result = check_datatypes(datatypes, value);
  } else if(type == "function") {
    result = check_function(field.results.name, field.results.args, value);
  } else {
    console.log('Unsupported type: ', type);
  }
  if(result) {
      result.table = table;
      result.cell = a1(table, column, row);
  }
  return result;
}

// Given an array of rows, zip the headers and return an array of row objects.
function dict(rows) {
  var headers = rows.shift();
  var results = [];
  for(var i in rows) {
    var result = {};
    for(var j in headers) {
      result[headers[j]] = rows[i][j];
    }
    results.push(result);
  }
  return results;
}

// Given a table name, return an array of row objects.
function table_dict(table) {
  return dict(tables[table]);
}

const deepCopy = (inObject) => {
  let outObject, value, key

  if (typeof inObject !== "object" || inObject === null) {
    return inObject // Return the value if inObject is not an object
  }

  // Create an array or object to hold the values
  outObject = Array.isArray(inObject) ? [] : {}

  for (key in inObject) {
    value = inObject[key]

    // Recursively (deep) copy for nested objects, including arrays
    outObject[key] = deepCopy(value)
  }

  return outObject
}

// Given a table and column, return the field row.
function get_field(table, column) {
  //var fields = table_dict('field');
  var fields = tables['field'];
  for(var i in fields) {
    var field = fields[i];
    if(field.table == table && field.column == column) {
      console.log('field', field);
      parser.feed(field.type);
      field.results = parser.results[0][0];
      parser.restore(parser_column);
      return field;
    }
  }
}

// Given a datatype, return a list of the ancestor datatypes (and self).
function get_datatypes(datatype) {
  var result = [];
  // var rows = table_dict('datatype');
  var rows = tables['datatype'];
  var x = 0;
  while(x < 100) {
    for (var i in rows) {
      var row = rows[i];
      if(row.datatype == datatype) {
        result.unshift(row);
        if(row.parent && row.parent != "") {
          datatype = row.parent;
        } else {
          return result;
        }
      }
    }
    x++;
  }
  return result;
}

// Given an array of datatypes and a value, check each datatype.
function check_datatypes(datatypes, value) {
  for(var i in datatypes) {
    var datatype = datatypes[i];
    if(datatype.match && datatype.match != '') {
      let re = new RegExp(datatype.match.substring(1, datatype.match.length -1));
      if(!re.test(value)) {
        return {
          rule: datatype.datatype,
          level: datatype.level,
          message: datatype.instructions,
        }
      }
    }
  }
}

function check_function(name, args, value) {
    if(name == 'CURIE') {
        console.log(name, args, value);
    } else {
        return {
            level: 'ERROR',
            message: 'Function not yet supported: ' + name,
        }
    }
}

function read_tsv(path) {
  return parse(fs.readFileSync(path), {delimiter: '\t', columns: true});
}

function read_tsv_headers(path) {
  return parse(fs.readFileSync(path), {delimiter: '\t', columns: false})[0];
}

var tables = {};
var headers = {};
var dir = 'immune_exposure/';
var table_names = ['datatype', 'field', 'rule', 'prefix', 'terminology', 'immune_exposure'];
for(var i in table_names) {
    var table_name = table_names[i];
    var path = dir + table_name + '.tsv';
    tables[table_name] = read_tsv(path);
    headers[table_name] = read_tsv_headers(path);
}

var result = validate_cell('terminology', 'ID', 17, 'FOO BAR ');
console.log(result);
