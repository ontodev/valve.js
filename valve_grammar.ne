@builtin "string.ne"
@{%
  const flatten = list => list.reduce((a, b) => a.concat(Array.isArray(b) ? flatten(b) : b), [])
  const nonspace = list => flatten(list).filter(item => item && item.type && item.type != "space")
  const join = list => flatten(list).join('')
%}

start -> _ expression _ {% d => d[1] %}

expression -> string {% id %} | function {% id %}

function -> function_name "(" arguments ")" {%
  function(d) {
    return {
      type: "function",
      name: d[0],
      args: d[2],
    }}%}

function_name -> ALPHANUM {% id %}

arguments -> _ argument (_ "," _ argument):* _ {% nonspace %}

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
_ -> [\s]:* {% function(d) { return {type: "space", value: join(d)}} %}

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
