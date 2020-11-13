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

build/valve_grammar.js: valve_grammar.ne | build
	nearleyc $< -o $@

build/nearley:
	cd build && git clone https://github.com/Hardmath123/nearley

build/valve_grammar_raw.py: valve_grammar.ne build/nearley
	python3 -m lark.tools.nearley $< expression $(word 2,$^) --es6

# Generate grammar, then ...
# 1. Remove init babel from first line
# 2. Encase grammar in triple quotes to allow for line breaks
# 3. Replace literal '\n' with line breaks
# 4. Fix extra escaping
# 5. Fix extra escaping on single quotes
# 6. Add escaping for double quotes (double quotes must be escaped within double quoted text)
# 7. Fix empty escaping (Lark will yell at you for \\)
# 8. Add x flag to regex using '\n'
# 9. Format using black
build/valve_grammar.py: build/valve_grammar_raw.py
	tail -n +2 $< | \
	perl -pe "s/grammar = (.+)/grammar = ''\1''/g" | \
	perl -pe 's/(?<!\\)\\n/\n/gx' | \
	perl -pe 's/\\\\/\\/gx' | \
	perl -pe "s/\\\'/'/g" | \
	perl -pe 's/"\\\"/"\\\\"/g' | \
	perl -pe 's/"\\\\"$$/"\\\\\\\\"/g' | \
	perl -pe 's/(\/\[.*\\n.*]\/)/\1x/g'> $@
	black --line-length 100 $@
