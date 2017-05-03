import wiki from 'wikijs'
import request from 'request'
import AWS from 'aws-sdk'
import fs from 'fs'
import uuidV4 from 'uuid/v4'
import async from 'async'
import path from 'path'

import { paragraphs, splitter } from '../../utils'

const Polly = new AWS.Polly({
  signatureVersion: 'v4',
  region: 'us-east-1'
})

const search = function (searchTerm, limit = 5, callback) {
  wiki().search(searchTerm, limit)
    .then((data) => callback(null, data.results))
    .catch((err) => callback(err))
}

const getPageContentHtml = function (title, callback) {
  wiki().page(title)
    .then((page) => page.html())
    .then((result) => {
      callback(null, result)
    })
    .catch((err) => callback(err))
}

const getSectionsFromWiki = function (title, callback) {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&format=json&page=${title}&prop=sections`
  request(url, (err, response, body) => {
    if (err) {
      return callback(err)
    }

    body = JSON.parse(body)

    const introSection = {
      title: 'Introduction',
      toclevel: 1,
      tocnumber: '',
      index: 0,
    }

    if (body && body.parse) {
      const { sections } = body.parse

      const parsedSections = sections.map((section) => {
        const { line } = section
        const regex = /(<([^>]+)>)/ig

        const s = {
          title: line.replace(regex, ''),
          toclevel: section.toclevel,
          tocnumber: section.number,
          index: section.index,
        }

        return s
      })

      const allSections = [introSection].concat(parsedSections)

      callback(null, allSections)
    } else {
      callback(null, [introSection])
    }
  })
}

const getTextFromWiki = function (title, callback) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&titles=${title}&explaintext=1&exsectionformat=wiki`
  request(url, (err, response, body) => {
    if (err) {
      return callback(err)
    }

    body = JSON.parse(body)

    if (body && body.query) {
      const { pages } = body.query
      let extract = ''

      if (pages) {
        for (const page in pages) {
          if (pages.hasOwnProperty(page)) {
            extract = pages[page]['extract']
            break
          }
        }
        callback(null, extract)
      } else {
        callback(null, '')
      }
    } else {
      callback(null, '')
    }
  })
}

const getSectionText = function (title, callback) {
  getTextFromWiki(title, (err, text) => {
    if (err) {
      return callback(err)
    }

    getSectionsFromWiki(title, (err, sections) => {
      if (err) {
        return callback(err)
      }

      let remainingText = text
      let lastSection

      const updatedSections = []

      // Extract sections from complete text
      for (let i = 1; i < sections.length; i++) {
        const { title, toclevel } = sections[i]
        const numEquals = Array(toclevel + 2).join('=')
        const regex = new RegExp(numEquals + ' ' + title + ' ' + numEquals, 'i') // == <title> ==
        if (remainingText) {
          const match = remainingText.split(regex)
          const [text, ...remaining] = match
          sections[i-1]['text'] = match[0]
          remainingText = remaining.join(numEquals + ' ' + title + ' ' + numEquals)

        }
        updatedSections.push(sections[i-1])

        // Note - last section is external links and is removed from the sections list
      }
      callback(null, updatedSections)
    })
  })
}

const breakTextIntoSlides = function (title, callback) {
  getSectionText(title, (err, sections) => {
    if (err) {
      console.log(err)
      return callback(err)
    }

    let updatedSections = []

    const sectionFunctionArray = []

    sections.map((section, index) => {
      const slides = []

      // Break text into 300 chars to create multiple slides
      const { text } = section
      const paras = paragraphs(text)
      let slideText = []

      paras.map((para) => {
        slideText = slideText.concat(splitter(para, 300))
      })

      const pollyFunctionArray = []

      function s (cb) {
        // For each slide, generate audio file using amazon polly
        slideText.forEach((text, index) => {
          if (text) {
            const params = {
              'Text': text,
              'OutputFormat': 'mp3',
              'VoiceId': 'Joanna'
            }

            function p (cb) {
              
              console.log(params)
              Polly.synthesizeSpeech(params, (err, data) => {
                if(err) {
                  cb(err)
                } else if (data) {
                  if(data.AudioStream instanceof Buffer) {
                    const filename = uuidV4() + '.mp3'
                    const randomFileName = path.join(__dirname, '../../../public/audio/' + filename)
                    fs.writeFile(randomFileName, data.AudioStream, function(err) {
                      if (err) {
                        console.log(err)
                        return cb(err)
                      }

                      slides.push({
                        text,
                        audio: '/audio/' + filename,
                      })

                      cb(null)
                    })
                  }
                }
              })
            }

            pollyFunctionArray.push(p)
          }
        })

        async.waterfall(pollyFunctionArray, function (err) {
          if (err) {
            console.log(err)
            return callback(err)
          }
          section['slides'] = slides
          updatedSections.push(section)
          cb(null)
          // callback(null, updatedSections)
        })
      }

      sectionFunctionArray.push(s)
      
    })

    async.waterfall(sectionFunctionArray, function (err) {
      if (err) {
        console.log(err)
        return callback(err)
      }
      callback(null, updatedSections)
    })
  })
}

export {
  search,
  getPageContentHtml,
  getSectionsFromWiki,
  getTextFromWiki,
  getSectionText,
  breakTextIntoSlides,
}
 