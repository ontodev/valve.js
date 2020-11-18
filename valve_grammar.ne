@builtin "string.ne"
@builtin "whitespace.ne"
@{%
  const first = d => d[0]
  const ffirst = d => d[0][0]
  const flatten = list => list.reduce((a, b) => a.concat(Array.isArray(b) ? flatten(b) : b), [])
  const objects = list => list.filter(item => item && typeof item == "object")
  const join = d => flatten(d).join('')
%}

expression -> negation | disjunction | datatype | function {% id %}

negation -> "not" _ expression {%
  function(d) {
    return {
      type: "negation",
      expression: d[2][0],
    } } %}

disjunction -> expression (_ "or" _ expression):+ {%
  function(d) {
    return {
      type: "disjunction",
      disjuncts: objects(flatten(d)),
    } } %}

function -> function_name "(" arguments ")" {%
  function(d) {
    return [{
      type: "function",
      name: d[0][0],
      args: d[2],
    }] } %}

function_name -> WORD

arguments -> argument ("," _ argument):* {%
  function(d) {
    return flatten(d).filter(item => item && item != ",");
  } %}

argument -> datatype | dqstring | field | function | int | named_arg | regex

field -> label "." label {% function(d) {
  return {
    type: "field",
    table: d[0][0],
    column: d[2][0],
  }}%}

datatype -> [A-Za-z] ALPHANUM {%
  function(d) {
    return {
      type: "datatype",
      name: d[0] + d[1],
    } } %}

named_arg -> WORD "=" label {% function(d) {
   return {
     type: "named_arg",
     name: d[0],
     value: d[2][0],
   }}%}

regex -> regex_sub | regex_match

regex_sub -> "s/" regex_pattern "/" regex_pattern "/" regex_flag {%
  function(d) {
    return {
      type: "regex",
      pattern: d[1][0],
      replace: d[3][0].replace("\\", ""),
      flags: d[5],
    } } %}

regex_match -> "s/" regex_pattern "/" regex_flag {%
  function(d) {
    return {
      type: "regex",
      pattern: d[1][0],
      flags: d[3],
    } } %}

regex_pattern -> regex_escaped | regex_unescaped
regex_escaped -> regex_unescaped "\\/" regex_unescaped {%
  function(d) {
    return flatten(d).join("")
  } %}
regex_unescaped -> [^/]:* {% join %}
regex_flag -> [a-z]:* {% join %}

label -> WORD | dqstring
int -> INTEGER {% parseInt %}

ALPHANUM -> [a-zA-Z0-9-_]:* {% join %}
INTEGER -> [0-9]:+ {% join %}
WORD -> [a-zA-Z-_]:+ {% join %}
