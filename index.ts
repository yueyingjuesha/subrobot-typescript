const fs = require('fs')
const path = require('path')
const z = require('zero-fill')
const fileExists = require('file-exists').sync
const MatroskaSubtitles = require('matroska-subtitles')
const translator = require('@iamtraction/google-translate')

const taskQueue: any[] = []
const batchSize = 10
const batchTimeInterval = 10000
var designatedTrackNumber = -1


// translator("hello world!\n where is my cousins \n I don't know! \n", {from: 'en', to: 'zh-cn'}).then((res: any) => {
// 	console.log(res.text)
// }).catch((err: any) => console.error(err))
// console.log("hello again!")



// https://stackoverflow.com/questions/9763441/milliseconds-to-time-in-javascript
function msToTime (s: any) {
  const ms = s % 1000
  s = (s - ms) / 1000
  const secs = s % 60
  s = (s - secs) / 60
  const mins = s % 60
  const hrs = (s - mins) / 60

  return z(2, hrs) + ':' + z(2, mins) + ':' + z(2, secs) + ',' + z(3, ms)
}



const mkvSubtitleExtractor = (mkvPath: string, outputDir: string) => new Promise((resolve, reject) => {
  const dir = outputDir || path.dirname(mkvPath)
  const name = path.basename(mkvPath, path.extname(mkvPath))

  // create srt path from language suffix
  const srtPath = function (language: string) {
    const languageSuffix = language ? '.' + language : ''
    return path.join(dir, name + languageSuffix + '.srt')
  }

  const tracks = new Map()
  const subs = new MatroskaSubtitles()

  subs.once('tracks', (tracks_: any[]) => {
    tracks_.forEach(track => {
      // sometimes `und` (undefined) is used as the default value, instead of leaving the tag unassigned
      const language = track.language !== 'und' ? track.language : null
      if (language && language != 'en') {
        return
      }
      if (designatedTrackNumber != -1) {
        return
      }

      designatedTrackNumber = track.number
      let subtitlePath = srtPath(language)

      tracks.set(track.number, {
        index: 1,
        file: fs.createWriteStream(subtitlePath),
        language
      })
    })
  })

  subs.on('subtitle', (sub: any, trackNumber: number) => {
    if (trackNumber != designatedTrackNumber) {
      return
    }
    const track = tracks.get(trackNumber)
    pushTask(track.index++, track, sub)
  })

  subs.on('finish', () => {
    const finishTracks: any[] = []

    tracks.forEach((track, i) => {
      track.file.end()
      finishTracks.push({number: i, path: track.file.path, language: track.language})
    })
    resolve(finishTracks)
  })

  const file = fs.createReadStream(mkvPath)
  file.on('error', (err: any) => reject(err))
  file.pipe(subs)
})

const pushTask = (index: number, track: any, sub: any) => {
  taskQueue.push({index, track, sub})
}

setInterval(() => {
  console.log("#############Starting Batch Translation#################")
  const batchTasks: any[] = []
  const curSize = taskQueue.length
  for (let i = 0; i < batchSize && i < curSize; i++) {
    const task = taskQueue.shift()
    if (task === undefined) {
      continue
    }
    batchTasks.push(task)
  }
  const requestTextArray: any[] = []
  batchTasks.map((task) => {
    requestTextArray.push(task.sub.text)
  })
  const requestText = requestTextArray.join('|')

  translator(requestText, {from: 'en', to: 'zh-cn'}).then((res: any) => {
    const splitText = res.text.split('|')
    const batchTasksLength = batchTasks.length
    for (let i = 0; i < splitText.length && i < batchTasksLength; i++) {
      const {index, track, sub} = batchTasks[i]
      track.file.write(`${index}\r\n`)
      track.file.write(`${msToTime(sub.time)} --> ${msToTime(sub.time + sub.duration)}\r\n`)
      console.log(`${sub.text.replace(/[\r\n]+/g, " ")} --> ${splitText[i].replace(/[\r\n]+/g, " ")}`)
      track.file.write(`${splitText}\r\n`)
      track.file.write(`${sub.text}\r\n\r\n`)
    }
  }).catch((err: any) => console.error(err))
}, batchTimeInterval)


mkvSubtitleExtractor("/mnt/f/Movie/Dune (2021)/Dune.2021.1080p.HMAX.WEB-DL.DDP5.1.Atmos.HDR.H.265-FLUX.mkv", "/mnt/f/Movie").then((res: any) => {
  console.log("translation finished")
}).catch((err: any) => console.error(err))
