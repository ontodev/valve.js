// Generated automatically by nearley, version 2.19.7
// http://github.com/Hardmath123/nearley
(function () {
function id(x) { return x[0]; }

  const flatten = list => list.reduce((a, b) => a.concat(Array.isArray(b) ? flatten(b) : b), [])
  const nonspace = list => flatten(list).filter(item => item && item.type && item.type != "space")
  const join = list => flatten(list).join('')
var grammar = {
    Lexer: undefined,
    ParserRules: [
    {"name": "dqstring$ebnf$1", "symbols": []},
    {"name": "dqstring$ebnf$1", "symbols": ["dqstring$ebnf$1", "dstrchar"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "dqstring", "symbols": [{"literal":"\""}, "dqstring$ebnf$1", {"literal":"\""}], "postprocess": function(d) {return d[1].join(""); }},
    {"name": "sqstring$ebnf$1", "symbols": []},
    {"name": "sqstring$ebnf$1", "symbols": ["sqstring$ebnf$1", "sstrchar"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "sqstring", "symbols": [{"literal":"'"}, "sqstring$ebnf$1", {"literal":"'"}], "postprocess": function(d) {return d[1].join(""); }},
    {"name": "btstring$ebnf$1", "symbols": []},
    {"name": "btstring$ebnf$1", "symbols": ["btstring$ebnf$1", /[^`]/], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "btstring", "symbols": [{"literal":"`"}, "btstring$ebnf$1", {"literal":"`"}], "postprocess": function(d) {return d[1].join(""); }},
    {"name": "dstrchar", "symbols": [/[^\\"\n]/], "postprocess": id},
    {"name": "dstrchar", "symbols": [{"literal":"\\"}, "strescape"], "postprocess": 
        function(d) {
            return JSON.parse("\""+d.join("")+"\"");
        }
        },
    {"name": "sstrchar", "symbols": [/[^\\'\n]/], "postprocess": id},
    {"name": "sstrchar", "symbols": [{"literal":"\\"}, "strescape"], "postprocess": function(d) { return JSON.parse("\""+d.join("")+"\""); }},
    {"name": "sstrchar$string$1", "symbols": [{"literal":"\\"}, {"literal":"'"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "sstrchar", "symbols": ["sstrchar$string$1"], "postprocess": function(d) {return "'"; }},
    {"name": "strescape", "symbols": [/["\\/bfnrt]/], "postprocess": id},
    {"name": "strescape", "symbols": [{"literal":"u"}, /[a-fA-F0-9]/, /[a-fA-F0-9]/, /[a-fA-F0-9]/, /[a-fA-F0-9]/], "postprocess": 
        function(d) {
            return d.join("");
        }
        },
    {"name": "start", "symbols": ["_", "expression", "_"], "postprocess": d => d[1]},
    {"name": "expression", "symbols": ["string"], "postprocess": id},
    {"name": "expression", "symbols": ["function"], "postprocess": id},
    {"name": "function", "symbols": ["function_name", {"literal":"("}, "arguments", {"literal":")"}], "postprocess": 
        function(d) {
          return {
            type: "function",
            name: d[0],
            args: d[2],
          }}},
    {"name": "function_name", "symbols": ["ALPHANUM"], "postprocess": id},
    {"name": "arguments$ebnf$1", "symbols": []},
    {"name": "arguments$ebnf$1$subexpression$1", "symbols": ["_", {"literal":","}, "_", "argument"]},
    {"name": "arguments$ebnf$1", "symbols": ["arguments$ebnf$1", "arguments$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "arguments", "symbols": ["_", "argument", "arguments$ebnf$1", "_"], "postprocess": nonspace},
    {"name": "argument", "symbols": ["string"]},
    {"name": "argument", "symbols": ["field"]},
    {"name": "argument", "symbols": ["function"]},
    {"name": "argument", "symbols": ["named_arg"]},
    {"name": "argument", "symbols": ["regex"]},
    {"name": "field", "symbols": ["label", {"literal":"."}, "label"], "postprocess": 
        function(d) {
          return {
            type: "field",
            table: d[0],
            column: d[2],
          }}},
    {"name": "named_arg", "symbols": ["label", {"literal":"="}, "label"], "postprocess": 
        function(d) {
          return {
            type: "named_arg",
            key: d[0],
            value: d[2],
          }}},
    {"name": "string", "symbols": ["label"], "postprocess": 
        function(d) {
          return {
            type: "string",
            value: d[0],
          }}},
    {"name": "label", "symbols": ["ALPHANUM"], "postprocess": id},
    {"name": "label", "symbols": ["dqstring"], "postprocess": id},
    {"name": "ALPHANUM$ebnf$1", "symbols": [/[a-zA-Z0-9-_]/]},
    {"name": "ALPHANUM$ebnf$1", "symbols": ["ALPHANUM$ebnf$1", /[a-zA-Z0-9-_]/], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "ALPHANUM", "symbols": ["ALPHANUM$ebnf$1"], "postprocess": join},
    {"name": "_$ebnf$1", "symbols": []},
    {"name": "_$ebnf$1", "symbols": ["_$ebnf$1", /[\s]/], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "_", "symbols": ["_$ebnf$1"], "postprocess": function(d) { return {type: "space", value: join(d)}}},
    {"name": "regex", "symbols": ["regex_sub"]},
    {"name": "regex", "symbols": ["regex_match"]},
    {"name": "regex_match", "symbols": [{"literal":"/"}, "regex_pattern", {"literal":"/"}, "regex_flag"], "postprocess": 
        function(d) {
          return {
            type: "regex",
            pattern: d[1][0],
            flags: d[3],
          }}},
    {"name": "regex_sub$string$1", "symbols": [{"literal":"s"}, {"literal":"/"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "regex_sub", "symbols": ["regex_sub$string$1", "regex_pattern", {"literal":"/"}, "regex_pattern", {"literal":"/"}, "regex_flag"], "postprocess": 
        function(d) {
          return {
            type: "regex",
            pattern: d[1][0],
            replace: d[3][0].replace("\\", ""),
            flags: d[5],
          }}},
    {"name": "regex_pattern", "symbols": ["regex_escaped"]},
    {"name": "regex_pattern", "symbols": ["regex_unescaped"]},
    {"name": "regex_escaped$string$1", "symbols": [{"literal":"\\"}, {"literal":"/"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "regex_escaped", "symbols": ["regex_unescaped", "regex_escaped$string$1", "regex_unescaped"], "postprocess": 
        function(d) {
          return flatten(d).join("")
        }},
    {"name": "regex_unescaped$ebnf$1", "symbols": []},
    {"name": "regex_unescaped$ebnf$1", "symbols": ["regex_unescaped$ebnf$1", /[^/]/], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "regex_unescaped", "symbols": ["regex_unescaped$ebnf$1"], "postprocess": join},
    {"name": "regex_flag$ebnf$1", "symbols": []},
    {"name": "regex_flag$ebnf$1", "symbols": ["regex_flag$ebnf$1", /[a-z]/], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "regex_flag", "symbols": ["regex_flag$ebnf$1"], "postprocess": join}
]
  , ParserStart: "start"
}
if (typeof module !== 'undefined'&& typeof module.exports !== 'undefined') {
   module.exports = grammar;
} else {
   window.grammar = grammar;
}
})();
