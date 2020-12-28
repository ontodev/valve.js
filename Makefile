# export PATH=$(npm bin):$PATH

tests: test-grammar test-no-ws

test-grammar: tests/expected.txt build/actual.txt
	diff $^

test-no-ws: build/expected-min.txt build/actual-min.txt
	diff -w $^

build:
	mkdir -p $@

build/actual.txt: valve/valve_grammar.js | build
	nearley-test -q -i 'identifier' $< > $@
	nearley-test -q -i 'func(id, "quoted string", table.column, /match/g, s/sub/tute/i, named="arg ument")' $< >> $@
	nearley-test -q -i 'a(b(c(d)))' $< >> $@
	nearley-test -q -i ' space( foo ,  "" )	' $< >> $@
	nearley-test -q -i '_mess_(/()/, ", foo(bar) \n")' $< >> $@

build/actual-min.txt: build/actual.txt
	cat $< | tr -d '\n' > $@

build/expected-min.txt: tests/expected.txt
	cat $< | tr -d '\n' > $@

valve/valve_grammar.js: valve_grammar.ne | build
	nearleyc $< -o $@
