@builtin "string.ne"
@builtin "whitespace.ne"
@{%
  const flatten = list => list.reduce((a, b) => a.concat(Array.isArray(b) ? flatten(b) : b), [])
  const object = list => list.filter(item => item && typeof item == "object")[0]
  const join = d => flatten(d).join('')
%}

expression -> _ ( string | function ) _ {%
  function(d) {
    return d[1][0]
    }%}

function -> function_name "(" arguments ")" {%
  function(d) {
    return {
      type: "function",
      name: d[0],
      args: d[2],
    }}%}

function_name -> ALPHANUM {% id %}

arguments -> _ argument (_ "," _ argument):* _ {%
  function(d) {
    return flatten(d).filter(item => item && item != ",")
  }%}

argument -> string | field | function | named_arg | regex

field -> label "." label {%
  function(d) {
    return {
      type: "field",
      table: d[0],
      column: d[2],
    }}%}

named_arg -> label "=" label {%
  function(d) {
    return {
      type: "named_arg",
      key: d[0],
      value: d[2],
    }}%}

string -> label {%
  function(d) {
    return {
      type: "string",
      value: d[0],
    }}%}

label -> ALPHANUM {% id %} | dqstring {% id %}
ALPHANUM -> [a-zA-Z0-9-_]:+ {% join %}

regex -> regex_sub | regex_match

regex_match -> "/" regex_pattern "/" regex_flag {%
  function(d) {
    return {
      type: "regex",
      pattern: d[1][0],
      flags: d[3],
    }}%}

regex_sub -> "s/" regex_pattern "/" regex_pattern "/" regex_flag {%
  function(d) {
    return {
      type: "regex",
      pattern: d[1][0],
      replace: d[3][0].replace("\\", ""),
      flags: d[5],
    }}%}

regex_pattern -> regex_escaped | regex_unescaped
regex_escaped -> regex_unescaped "\\/" regex_unescaped {%
  function(d) {
    return flatten(d).join("")
  }%}
regex_unescaped -> [^/]:* {% join %}
regex_flag -> [a-z]:* {% join %}
