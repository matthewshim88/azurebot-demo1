const builder = require('botbuilder');
const botbuilder_azure = require('botbuilder-azure');
const movieDB = require('moviedb')(process.env.moviedb_key);
const wordsToNum = require('words-to-num');
const request = require('superagent');
require('datejs');


//setup Connector
const connector = new botbuilder_azure.BotServiceConnector({
  appId: process.env.appId,
  appPassword: process.env.appPassword,
  stateEndpoint: process.env['BotStateEndpoint'],
  openIdMetadata: process.env['BotOpenIdMetadata']
})
const bot = new builder.UniversalBot(connector);


//setup LUIS 
const luisURL = 'westus.api.cognitive.microsoft.com/luis/v2.0/apps';
const luisModeURL = `https://${luisURL}/${process.env.LUIS_APP_ID}/?subscription-key=${process.env.LUIS_API_KEY}`;

const recognizer = new builder.LuisRecognizer(luisModeURL);

const intents = new builder.IntentDialog({ recognizers : [recognizer] }); // note array of models, can pass in multiple
bot.dialog('/', intents);

const imgBaseUrl = 'https://image.tmdb.org/t/p/';
const posterSize = 'w185';

const genres = {
  action: {
    id: 28,
  },
  adventure: {
    id: 12,
  },
  animation: {
    id: 16,
  },
  comedy: {
    id: 35,
  },
  documentary: {
    id: 99,
  },
  drama: {
    id: 18,
  },
  horror: {
    id: 27,
  },
  mystery: {
    id: 9648,
  },
  romance: {
    id: 10749,
  },
  music: {
    id: 10402,
  },
  thriller: {
    id: 53,
  },
  war : {
    id: 10752,
  },
  western : {
    id : 37,
  },
  scifi : {
    id: 878,
  }, 
  crime : {
    id: 80
  },
  '(quit)': {
    id: 0,
  },
};


const getMovie = (session) => {
  // Send typing message
  session.sendTyping();

  const params = {};
  if(session.dialogData.genre){
    params.with_genres = session.dialogData.genre;
  }
  if (session.dialogData.sort){
    params.sort_by = session.dialogData.sort === 'popularity' ? 'popularity.desc' : 'vote_average.desc';
  }
  if(session.dialogData.year){
    params.primary_release_year = session.dialogData.year;
  }

  // Call the Movie DB API passing the params object from above
  movieDB.discoverMovie(params, (err, res) => {
    const msg = new builder.Message(session);
    // If there's no error
    if (!err) {
      const movies = res.results;
      let number = session.dialogData.number ? session.dialogData.number : 1;
      let startIndex = 0;
      const maxMoviesToShow = 10;
      
      if ( number > maxMoviesToShow ){
        number = maxMoviesToShow;
        session.send(`Sorry, I can only show the first ${maxMoviesToShow} movies:\n\n`);
      }else if ( number === 1 ){
        startIndex = Math.floor(Math.random() * maxMoviesToShow);
        number = startIndex + 1;
      }

      const cards = []; // holds movie cards

      movies.slice(startIndex, number).forEach((movie) => {
        const card = new builder.HeroCard(session);
        card.title(movie.title);
        card.text(movie.overview);
        card.buttons([
          builder.CardAction.openUrl(session, `https://www.themoviedb.org/movie/${movie.id}`, 'Movie Info'),
        ]);

        if(movie.poster_path){
          const imgUrl = `${imgBaseUrl}${posterSize}${movie.poster_path}`;
          card.images([
            builder.CardImage.create(session, imgUrl)
              .tap(builder.CardAction.showImage(session, imgUrl)),
          ]);
        }
        cards.push(card);
      });

      msg.attachmentLayout(builder.AttachmentLayout.carousel).attachments(cards);
    } else {
      msg.text(`Oops, an error, can you please say 'movie' again?`);
    }
    // End the dialog
    session.endDialog(msg);
  });
};


// initial Intents
intents.matches('Hello', [
  (session, args, next) => {
    if(!session.userData.name) {
      session.beginDialog('/askName');
    }else{
      next();
    }
  },
  session =>
    builder.Prompts.text(session, `Hi ${session.userData.name}, How are you?`),
    (session, results) => {
      request
        .post('https://westus.api.cognitive.microsoft.com/text/analytics/v2.0/sentiment')
        .send({
          documents: [
            {
              language: 'en',
              id: '1',
              text: results.response,
            },
          ],
        })
        .set('Ocp-Apim-Subscription-Key', process.env.Ocp_Apim_Key)
        .set('Content-Type', 'application/json')
        .end((err, res) => {
          if(!err){
            console.log(res.body);
            if(res.body.documents[0].score > 0.6){
              session.send('Good');
            }else{
              session.send(`I'm sorry you feel that way, maybe a Comedy will cheer you up?`);
              session.dialogData.genre = genres.comedy.id;
              getMovie(session);
            }
          }
          session.send('I know About All Movies, just ask Anytime!');
        })
    }
])
// LUIS.ai can't match better
.matches('None', (session) => { 
  session.send(`Sorry I didn't understand, I'm a bot`);
})
// user message matches intent 'movie'
.matches('Movie', [
  (session, args, next) => {
    const genreEntity = builder.EntityRecognizer.findEntity(args.entities, 'genre');
    const sortPopularityEntity = builder.EntityRecognizer.findEntity(args.entities, 'sort::popularity');
    const numberEntity = builder.EntityRecognizer.findEntity(args.entities, 'builtin.number');
    const dateEntity = builder.EntityRecognizer.findEntity(args.entities, 'builtin.datetime.date');

    if(genreEntity){
      const match = builder.EntityRecognizer.findBestMatch(genres, genreEntity.entity);
      const genreObj = match ? genres[match.entity] : null;
      session.dialogData.genre = genreObj ? genreObj.id : null;
    }
    if(dateEntity){
      const date = Date.parse(dateEntity.resolution.date);
      session.dialogData.year = date ? date.getFullYear() : null;
    }
    if(numberEntity){
      const num = wordsToNum.convert(numberEntity.entity);
      session.dialogData.number = session.dialogData.year === num ? 1: num;
    }
    session.dialogData.sort = sortPopularityEntity ? 'popularity' : 'votes';

    next();
  },
  (session, results, next) => {
    if(!session.dialogData.year){
      session.beginDialog('/yearPrompt');
    }else{
      next();
    }
  },
  (session, results) => {
    if(results && results.response){
      session.dialogData.year = results.response;
    }
    getMovie(session);
  }
]);


// BOT DIALOGS BELOW 

bot.dialog('/askName', [
  session =>
    builder.Prompts.text(session, `Hi! I'm MovieBot. What's your name?`),
  (session, results) => {
    // Store the user's name on the userData session attribute
    session.userData.name = results.response;
    session.endDialog();
  },
]);


bot.dialog('/yearPrompt', [
  session =>
    builder.Prompts.text(session, `Enter a release year ( YYYY )`),
  (session, results) => {
    const matched = results.response.match(/\d{4}/g);

    session.endDialogWithResult({ response: matched });
  }
]);

module.expots = { default: connector.listen()};