Install
-------

    sudo apt-get install nodejs npm
    sudo ln -s /usr/bin/nodejs /usr/local/bin/node # for bower
    sudo npm install -g bower
    bower install
    npm install

Run
---

    node server

Point your browser at http://localhost:8080 -- note that you need two players
to create a game.

Tests
-----

Run tests using:

    jasmine-node spec

Make sure you have jasmine-node installed:

	sudo npm install -g jasmine-node

TODO
----

 - implement dispatcher
    [x] drive
    [x] charter flight
    [x] direct flight
    [x] shuttle flight
    [x] converge
 - hand limit
 - eradicate disease
 - defeat: run out of player cards
 - victory
 - feedback on actions rejected by server
 - share knowledge UI
 - special events
 - make ui-sortable work on touch devices; http://touchpunch.furf.com/
 - keep private information private (e.g. hand cards)
 - more input sanitation (e.g. location / player IDs in action)
