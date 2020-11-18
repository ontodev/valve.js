# npm install nearley csv-parse
# export PATH=$(npm bin):$PATH 

test: tests/expected.txt build/actual.txt
	diff $^

build:
	mkdir -p $@

build/actual.txt: build/valve_grammar.js | build
	set -x && nearley-test -q -i 'prefix' $< > $@
	nearley-test -q -i 'not prefix' $< >> $@
	nearley-test -q -i 'blank or prefix' $< >> $@
	nearley-test -q -i 'CURIE(prefix.prefix)' $< >> $@
	nearley-test -q -i 'CURIE(prefix."xspace prefix")' $< >> $@
	nearley-test -q -i 'CURIE(named=arg)' $< >> $@
	nearley-test -q -i 'split(prefix.prefix, "&", foo(bar), CURIE(prefix.prefix))' $< >> $@
	nearley-test -q -i 'a(b(c(d)))' $< >> $@
	nearley-test -q -i 'in(with-dash."space column")' $< >> $@
	nearley-test -q -i 'regex(s/pattern/replacement/gi)' $< >> $@
	nearley-test -q -i 'regex(s/pat\/ern/replacement/)' $< >> $@
	nearley-test -q -i 'x(foo, 2, bar2)' $< >> $@

build/valve_grammar.js: valve_grammar.ne | build
	nearleyc $< -o $@
