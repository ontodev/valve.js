# export PATH=$(npm bin):$PATH 

test: valve_grammar.js
	nearley-test -q -i 'prefix' $<
	nearley-test -q -i 'not prefix' $<
	nearley-test -q -i 'blank or prefix' $<
	nearley-test -q -i 'CURIE(prefix.prefix)' $<
	nearley-test -q -i 'split(prefix.prefix, "&", foo(bar), CURIE(prefix.prefix))' $<
	# nearley-test -q -i 'a(b(c(d)))' $<


valve_grammar.js: valve_grammar.ne
	nearleyc $< -o $@
