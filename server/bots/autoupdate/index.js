import wiki from 'wikijs'
import request from 'request'
import async from 'async'
import slug from 'slug'

import Article from '../../models/Article'
import User from '../../models/User'

import { paragraphs, splitter, textToSpeech, deleteAudios } from '../../utils'

import { getSectionText, applySlidesHtmlToArticle } from '../../controllers/wiki';
// import { oldUpdatedSlides } from './updatedSections';
import { removeDeletedSlides, 
        getSlidesPosition, 
        fetchUpdatedSlidesMeta, 
        getDifferences, 
        addRandomMediaOnSlides
        } from './helpers';

const console = process.console; 
var changedSlidesNumber = 0;
var convertedCharactersCounter = 0;

const bottest = function(req, res) {
    const title = req.params.title || 'The_Dewarists';

    Article.findOne({title, published: true}, (err, article) => {
        if(err) return res.json(err);
        if(!article) return res.end('No published article with this title!');

        updateArticle(article, (err, result) =>{
            if(err) return res.json({err: JSON.strigify(err)})
            return res.json(result)
        });
    });
    // const deletedAudios = ['e2a44b9f-c359-4403-a7a7-6498878e6463.mp3'];

    // deleteAudios(deletedAudios, (err, data) => {
    //     res.json({err, data});
    // });

    // runBot(4);
}
const runBot = function(limitPerOperation){
    // get number of articles to be updated
    Article
    .find({ published: true })
    .select('title')
    .where('slides.500').exists(false)
    .exec( (err, result) => {
        if(err) return callback(err);
        // setup a queue for performing updates on article sets
        const numberOfArticles = result.length;
        console.log('Number of published articles: ', numberOfArticles)
        var q = articlesQueue();

        for(var i = 0; i < numberOfArticles; i+=limitPerOperation) {
            q.push({skip: i, limitPerOperation: limitPerOperation});
        }

        q.drain =function(){
            console.log("------------------- Successfully updated all articles ----------------------");
            console.log("------------------- Total number of converted slides is " + changedSlidesNumber + "------------------------");
            console.log("------------------- Total number of converted characters" + convertedCharactersCounter + "--------------------");
            changedSlidesNumber = 0;
            convertedCharactersCounter = 0;
        };

    })

}

const articlesQueue = function(){
    return async.queue((task, callback) => {

        Article 
        .find({ published: true })
        .sort({ created_at: 1 })
        .where('slides.500').exists(false)
        .skip( task.skip )
        .limit( task.limitPerOperation )
        .exec((err, articles) => {
            if(err) return callback(err);
             if(!articles) return callback(null); // end of articles
            updateArticles(articles, (err, results)=>{
                console.log('task done ' + task.skip );
                let modifiedArticles = results.map(result => {
                    return {
                        title: result.value.article.title,
                        modified: result.value.modified
                    }
                });

                saveUpdatedArticles(results.map( result => result.value.article ), (err, result) =>{
                    console.log(err, result);

                    // Update slidesHtml after saving updated articles
                    let updateSlidesHtmlArray = [];
                    modifiedArticles.forEach(article => {

                        function ush(cb) {
                            applySlidesHtmlToArticle(article.title, (err, result) => {
                                cb();
                            })
                        }

                        if (article.modified) {
                            updateSlidesHtmlArray.push(ush);
                        }
                    })

                    async.parallel(async.reflectAll(updateSlidesHtmlArray), (err, results) => {

                    })

                    return callback(err, result);
                });
            });
        })
    })
} 

const saveUpdatedArticles = function(articles, callback) {
    var updateArray = [];
    const updated_at = Date.now();

    articles.forEach( article => {
        var query = { 
            updateOne: {
                filter: { _id: article._id },
                update: { 
                    $set: { 
                            "slides": article.slides, 
                            "sections": article.sections, 
                            "updated_at": updated_at
                        } 
                    }
        }};
        updateArray.push(query);
    });

    Article.bulkWrite(updateArray)
        .then(res =>  callback(null, res))
        .catch(err => callback(err));
}

const updateArticles = function(articles, callback) {
     var articleUpdateFunctionArray = []; 
     articles.forEach( article => {
        function a(callback) {
            updateArticle(article, (err, newArticle) => {
                return callback(err,newArticle);
            })
        }
        articleUpdateFunctionArray.push(a);
     })
     
    async.parallel(async.reflectAll(articleUpdateFunctionArray), (err, results) => {
        if(err) return console.log(err);
        return callback(null, results);
    })
}

const updateArticle = function(article, callback) {
    getLatestData(article.title, (err, data) => {
       
        if(err) return callback(err);
        // compares the old articles with new articles fetched from wikipedia
        updateArticleSlides(article.slides, data.slides, (err2, result) => {
            if(err2) return callback(err2);

            article.slides = result.slides;
            article.sections = data.sections;
            let modified = false;
            if (result.removedSlidesBatch.length > 0 || result.addedSlidesBatch.length > 0) {
                modified = true;
            }
            return callback(null, {article, modified, result});
        //    Article.findOneAndUpdate({_id: article._id}, {
        //         slides: article.slides,
        //         sections: article.sections
        //     }
        //     ,{ new: true}
        //     , (err, newarticle) => {
        //         if(err) return callback(err);
        //         return callback(null, {newarticle, result});
        //     })
        });

    })


}
// compares the old articles with new articles fetched from wikipedia
const updateArticleSlides = function(oldUpdatedSlides, slides, callback) {

        const oldSlidesText = oldUpdatedSlides.map(obj => obj.text);
        const slidesText = slides.map(obj => obj.text);

        // Batch the removed and added slides
        var diffs = getDifferences(oldSlidesText, slidesText)  ;
        var addedSlidesBatch = diffs.addedBatch;
        var removedSlidesBatch = diffs.removedBatch;

        // get the slides array after removing the deleted slides
        var removedSlidesArray = getSlidesPosition(oldUpdatedSlides, removedSlidesBatch);
        // get the slides array after inserting the new slides
        var addedSlidesArray = getSlidesPosition(slides, addedSlidesBatch);
        // fetch old media to updated slides, 
        var  result = fetchUpdatedSlidesMeta(oldUpdatedSlides, addedSlidesArray, removedSlidesArray);
        addedSlidesArray = result.addedSlidesArray;
        const updatedslidesArray = result.updatedslidesArray;
        // adds media from existing media in the slides array to new slides without media  on
        addedSlidesArray = addRandomMediaOnSlides(oldUpdatedSlides, addedSlidesArray);

        addNewSlides(oldUpdatedSlides, addedSlidesArray, (err, resultSlides ) =>{
            removeDeletedSlides(resultSlides , removedSlidesArray, addedSlidesArray, (err, updatedSlides) => {
                // recalculate the position attribute on the slides ;
                for(var i = 0, len = updatedSlides.length; i<len; i++ ) {
                    updatedSlides[i].position = i;
                }

                return callback(null, { slides: updatedSlides, removedSlidesBatch, addedSlidesBatch, addedSlidesArray, removedSlidesArray, updatedslidesArray});

            });
        });
}




const addNewSlides = function(updatedSlides, addedSlidesArray, callback) {
    // TODO generate audio for new slides
    generateSlidesAudio(updatedSlides, addedSlidesArray, (err, newAddedSlides)=>{
        for(var i = 0; i < newAddedSlides.length; i++ ){
            updatedSlides.splice(newAddedSlides[i].position , 0, newAddedSlides[i]);
        }
        return callback(err, updatedSlides)
    })
}

const generateSlidesAudio = function(updatedSlides, slides, callback) {
    var pollyFunctionArray = [] ;
    var audifiedSlides = [];
    var updatedSlidesText = updatedSlides.map(slide => slide.text);
    // return callback(null, audifiedSlides);
    slides.forEach( slide => {
        if(slide.text){

            const params = {
                'Text': slide.text,
                'OutputFormat': 'mp3',
                'VoiceId': 'Joanna',
            }

            function p (cb) {
                // if the slide is already in the db and just the position updated
                // don't generate new audio.
                if(updatedSlidesText.indexOf(slide.text) > -1) {
                    audifiedSlides.push({
                        text: slide.text,
                        audio: slide.audio,
                        position: slide.position,
                        media: slide.media,
                        mediaType: slide.mediaType
                    })
                    updatedSlides.splice(updatedSlidesText.indexOf(slide.text), 1);
                    return cb(null)
                }else{
                    // audifiedSlides.push({
                    //     text: slide.text,
                    //     audio: 'path/to/new/audio',
                    //     position: slide.position,
                    //     media: slide.media,
                    //     mediaType: slide.mediaType
                    // })
                    // return cb(null)
                    changedSlidesNumber ++ ;
                    let textToConvert = slide.text ?  slide.text.trim() : slide.text;
                    if (textToConvert) {
                        convertedCharactersCounter += textToConvert.length;
                    }
                    console.log('Converting text ', textToConvert, changedSlidesNumber, convertedCharactersCounter);
                    textToSpeech(textToConvert, (err, audioFilePath) => {
                        if (err) {
                            return cb(err)
                        }

                        audifiedSlides.push({
                            text: slide.text,
                            audio: audioFilePath,
                            position: slide.position,
                            media: slide.media,
                            mediaType: slide.mediaType
                        })
                       return cb(null)
                    })
                }
                
            }
            pollyFunctionArray.push(p);

        }
    }); 

    async.waterfall(pollyFunctionArray, (err) => {
        if (err) {
            console.log(err)
            return callback(err)
        }

        callback(null, audifiedSlides);
    })
}



const getLatestData = function(title, callback){

 getSectionText(title, (err, sections) =>{

        if (err) {
            console.log(err)
            return callback(err)
        }

        getSectionsSlides(sections, (err, data) => {
            if (err) {
                console.log(err)
                return callback(err)
            }
            return callback(null, {slides: data.slides, sections: data.sections})
        })
        
        
    })
}

const getSectionsSlides = function(sections, callback) {
    
    const slides = []
    let currentPosition = 0
    sections.map((section) => {
        // Break text into 300 chars to create multiple slides
        const { text } = section
        const paras = paragraphs(text)
        let slideText = []

        paras.map((para) => {
            slideText = slideText.concat(splitter(para, 300))
        })

        section['numSlides'] = slideText.length
        section['slideStartPosition'] = currentPosition

        currentPosition += slideText.length

        slideText.forEach(function(text, index) {
            slides.push({
                text,
                position: (section['slideStartPosition'] + index),
            })
        });

    })

    return callback(null, {slides, sections})
}



export {
  bottest,
  updateArticle,
  updateArticleSlides,
  runBot
}

