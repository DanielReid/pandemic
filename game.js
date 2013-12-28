var _ = require('underscore');
var clone = require('clone');

function nameMatcher(name) {
  return function(arg) {
    return arg.name == name;
  };
}

function Game(gameDef, players, settings, eventSink, randy) {
  this.situation = null;
  this.parentState = null;

  this.findLocation = function(locationName) {
    return _.find(this.situation.locations, nameMatcher(locationName));
  }

  this.findDisease = function(diseaseName) {
    return _.find(this.situation.diseases, nameMatcher(diseaseName));
  }

  this.findDiseaseByLocation = function(locationName) {
    var diseaseName = this.findLocation(locationName).disease;
    return this.findDisease(diseaseName);
  }

  this.findPlayer = function(playerId) {
    return _.find(this.situation.players, function(player) { return player.id === playerId; });
  }

  function player_actions_state(player) {
    return {
      "name": "player_actions",
      "player": player,
      "actions_remaining": 4,
      "terminal": false
    };
  }

  function draw_player_cards_state(player) {
    return {
      "name": "draw_player_cards",
      "player": player,
      "draws_remaining": 2,
      "terminal": false
    };
  }

  this.emitStateChange = function() {
    eventSink.emit({
      "event_type": "state_change",
      "state": _.clone(this.situation.state)
    });
  };

  this.drawPlayerCard = function(player) {
    var card = this.situation.player_cards_draw.shift();
    eventSink.emit({
      "event_type": "draw_player_card",
      "player": player,
      "card": card
    });
    this.situation.state.draws_remaining--;
    if (card.type === "epidemic") {
      return this.handleEpidemic();
    } else {
      this.findPlayer(player).hand.push(card);
      return true;
    }
  }

  this.handleEpidemic = function() {
    eventSink.emit({"event_type": "infection_rate_increased"});
    if (!this.drawInfection(3, true)) {
      return false;
    }
    this.parentState = this.situation.state;
    this.situation.state = { "name": "epidemic" };
    this.emitStateChange();
    return true;
  };

  this.infect = function(loc, dis, num) {
    var max_infections = 3;

    var self = this;

    function _infect(locs, dis, out) {
      if (_.isEmpty(locs)) return true;

      var loc = _.first(locs);
      var location = self.findLocation(loc);

      // If an outbreak already occurred here, skip
      if (_.contains(out, loc)) return _infect(_.rest(locs), dis, out);

      // Outbreak
      if (location.infections[dis] === max_infections) {
        eventSink.emit({
          "event_type": "outbreak",
          "location": loc,
          "disease": dis
        });
        self.situation.outbreak_count++;
        if (self.situation.outbreak_count > self.situation.max_outbreaks) {
          self.situation.state = { "name": "defeat_too_many_outbreaks", "terminal": true };
          self.emitStateChange();
          return false;
        }
        return _infect(_.rest(locs).concat(location.adjacent), dis, out.concat([loc]));
      }

      // Out of cubes
      var disease = self.findDisease(dis);
      if (disease.cubes === 0) {
        self.situation.state = {
          "name": "defeat_too_many_infections",
          "disease": dis,
          "terminal": true };
        self.emitStateChange();
        return false;
      }

      // Infection
      location.infections[dis]++;
      disease.cubes--;
      eventSink.emit({
        "event_type": "infect",
        "location": loc,
        "disease": dis
      });

      return _infect(_.rest(locs), dis, out);
    }

    return _infect(_.times(num, function() { return loc; }), dis, []);
  };

  this.drawInfection = function(n, last) {
    var card;
    if (last) {
      card = this.situation.infection_cards_draw.pop();
    } else {
      card = this.situation.infection_cards_draw.shift();
    }
    this.situation.infection_cards_discard.unshift(card);
    eventSink.emit({
      "event_type": "draw_and_discard_infection_card",
      "card": card
    });

    var location = this.findLocation(card.location);
    return this.infect(location.name, location.disease, n);
  };

  this.startInfectionPhase = function(player) {
    var rate = this.situation.infection_rate_levels[this.situation.infection_rate_index].rate;
    this.situation.state = {
      "name": "draw_infection_cards",
      "player": player,
      "draws_remaining": rate,
      "terminal": false
    };
    this.emitStateChange();
  }

  this.setup = function() {
    var initialState = _.extend(clone(gameDef), settings);

    // assign roles
    var roles = _.map(gameDef.roles, function(role) { return role.name; });
    roles = randy.sample(roles, players.length);
    initialState.players = _.map(_.zip(players, roles),
        function(arr) {
          var player = _.object(["id", "role"], arr);
          player.location = gameDef.starting_location;
          player.hand = [];
          return player;
        });

    // create initial research center
    initialState.research_centers.push({ "location": gameDef.starting_location });
    initialState.research_centers_available--;

    // shuffle infection cards
    initialState.infection_cards_draw = randy.shuffle(gameDef.infection_cards_draw);

    // shuffle player cards and insert epidemic cards
    function setupPlayerCards() {
      var cards = randy.shuffle(gameDef.player_cards_draw);
      var nEpidemics = settings.number_of_epidemics;
      var initialDeal = gameDef.initial_player_cards[players.length];
      var nReserved = initialDeal * players.length;
      var nCards = gameDef.player_cards_draw.length;
      var n = nCards - nReserved;
      var chunkSize = Math.floor(n / nEpidemics);
      var larger = n - (nEpidemics * chunkSize);
      var counts = _.times(nEpidemics,
          function(index) {
            return chunkSize + (index < larger ? 1 : 0);
          });

      var chunks = _.map(counts,
          function(count) { 
            var chunk = [this.index, this.index + count];
            this.index += count;
            return chunk;
          },
          { "index": nReserved });

      return _.reduce(chunks, function(memo, chunk) {
          var where = randy.randInt(chunk[0], chunk[1]);
          return memo
            .concat(cards.slice(chunk[0], where))
            .concat([{ "type": "epidemic" }])
            .concat(cards.slice(where, chunk[1]));
        }, cards.slice(0, nReserved));
    }
    initialState.player_cards_draw = setupPlayerCards();
    initialState.state = { "name": "setup", "terminal": false };

    // Make the initial state known
    eventSink.emit({ "event_type": "initial_situation", "situation": initialState });

    this.situation = clone(initialState);
    var self = this;

    // Initial infections
    _.each(initialState.initial_infections, function(n) {
      self.drawInfection(n);
    });

    // Initial draws
    var nDraw = gameDef.initial_player_cards[players.length];
    _.each(_.range(nDraw), function(idx) {
      _.each(self.situation.players, function(player) {
        self.drawPlayerCard(player.id);
      });
    });

    // Give turn to first player
    this.situation.state = player_actions_state(self.situation.players[0].id);
    this.emitStateChange();
  };

  this.act = function(player, action) {
    if (action.name == "action_pass") {
      if (this.situation.state.name !== "player_actions") {
        return false;
      }
      if (player !== this.situation.state.player) {
        return false;
      }
      this.situation.state.actions_remaining--;
      if (this.situation.state.actions_remaining === 0) {
        this.situation.state = draw_player_cards_state(player);
      }
      this.emitStateChange();
      return true;
    } else if (action.name == "draw_player_card") {
      if (this.situation.state.name !== "draw_player_cards") {
        return false;
      }
      if (player !== this.situation.state.player) {
        return false;
      }
      if (!this.drawPlayerCard(player)) { // Defeat
        return true;
      }
      if (this.situation.state.draws_remaining === 0) {
        this.startInfectionPhase(player);
      }
      return true;
    } else if (action.name == "increase_infection_intensity") {
      if (this.situation.state.name !== "epidemic") {
        return false;
      }
      if (player !== this.parentState.player) {
        return false;
      }
      var cards = randy.shuffle(this.situation.infection_cards_discard);
      eventSink.emit({
        "event_type": "infection_cards_restack",
        "cards": cards
      });
      this.situation.infection_cards_discard = [];
      this.situation.infection_cards_draw = cards.concat(this.situation.infection_cards_draw);
      if (this.parentState.name !== "draw_player_cards") {
        throw "invalid state";
      }
      if (this.parentState.draws_remaining > 0) {
        this.situation.state = this.parentState;
        this.emitStateChange();
      } else {
        this.startInfectionPhase(player);
      }
      return true;
    } else if (action.name == "draw_infection_card") {
      if (this.situation.state.name !== "draw_infection_cards") {
        return false;
      }
      if (player !== this.situation.state.player) {
        return false;
      }
      if (!this.drawInfection(1)) { // Defeat
        return true;
      }
      this.situation.state.draws_remaining--;
      if (this.situation.state.draws_remaining === 0) {
        var players = this.situation.players;
        var index = _.indexOf(players, _.find(players, function(p) {
          return p.id === player;
        }));
        var nextPlayer = index + 1 === players.length ? players[0] : players[index + 1];
        this.situation.state = {
          "name": "player_actions",
          "player": nextPlayer.id,
          "actions_remaining": 4,
          "terminal": false
        };
      }
      this.emitStateChange();
      return true;
    }
    return false;
  };

  return this;
}

module.exports = Game;