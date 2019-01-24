/*
  Нагрузочное тестирование на основе файла в корне проекта har.json

  Файл со списком страниц формируется в Chrome следующим образом.
  Переходим в режим разработчика ctrl + shift + I
  Включаем вкладку Network, устанавливаем фильтр - All (все страницы или не все, а которые нужны).
  Устанавливаем логический атрибут Preserve log, чтобы сохранять все страницы при переходах.
  Открываем нужный ресурс, дожидаемся окончания загрузки. Если нужны другие страницы прехеодим по ним тоже.
  Щелкаем на любой записи загруженной страницы в списке правой кнопкой, пункт меню "Copy\Copy All as HAR".
  Открываем файл har.json, заменяем в нём содержимое.

  NB. Если тестовые страницы уже записаны, чтобы использовалась новую авторизацию - достаточно заменить код сессии.
  Найдите код сессии, например "name": "SSID",
  и значение "value": "ANkWDm_DYZHMqnQY2",
  Выберите любую страницу в бразуере, после авторизации кликом. В разделе Request - найдите новое значение SSID.
  Замените на него заменой во всем файле.
 */

const WAIT_TIMEOUT = 1500; // Максимальное время ожидания загрузки страницы
const MAX_SOCKET = 1000; // Кол-во сокетов
const MAX_RANDOM_WAIT = 1000; // Максимальное кол-во ожидание перед произвольной загрузкой страницы

const virtUser = typeof process.env.VIRTUAL_USER !== 'undefined' ? parseInt(process.env.VIRTUAL_USER) : 3; // Кол-во одновременных потоков. При большем кол-ве, если стоит защита от DDOS атаки - потоков растет кол-во ошибок - надо подбираться по производительности в секунду
const allTestIterations = typeof process.env.TESTS !== 'undefined' ? parseInt(process.env.TEST) : 100; // Кол-во циклов для каждого потока (т.е. общее кол-во запросов - пользователи * итерации)

const pagesRequesLog = require('./har.json').log;

const rp = require('request-promise');

let requestedURL = []; // Список адресов в URL на которых проверяем запросы, остальные игнорируем.

let now = new Date();
let curTimeInterval = now.getHours() + ':' + now.getMinutes(); // Текущий интервал времени.
let timeCheck = {};  // Массив информации о полученных данных по каждой минуте теста
timeCheck[curTimeInterval] = [];
let timeErr = {};
timeErr[curTimeInterval] = [];
let timePage = {};
timePage[curTimeInterval] = [];

pagesRequesLog.pages.forEach((curPage)=> {
  let tmpURL = curPage.title.match(/^(ht|f)tp(s?):\/\/[0-9a-zA-Z]([-.\w]*[0-9a-zA-Z])/)[0].replace(/^(ht|f)tp(s?):\/\//, '');
  if (requestedURL.indexOf(tmpURL) === -1) {
    requestedURL.push(tmpURL);
  }
});
console.log ('Список тестируемых серверов:', requestedURL.join('; '));

let finalizeTest = 0; // Завершенных тестов
let qntWorker = 0; // Кол-во воркеров запущенных

// Старт программы
for (let i = 0; i < virtUser; i++) {
  nextTest(i);
}

function nextTest(iteration) {
  qntWorker++;
  let timeStartTest = new Date();
  iteration = iteration ? iteration : finalizeTest;
  onceTest(iteration).then((result)=> {
    qntWorker--;
    let timeEndTest = new Date();
    timePage[curTimeInterval].push((timeEndTest - timeStartTest) / 1000);
    finalizeTest++;
    if (finalizeTest < virtUser * allTestIterations - qntWorker) {
      //console.log(`${iteration}: время загрузки`, (timeEndTest - timeStartTest) / 1000, 'с', 'Новый тест', virtUser + finalizeTest, 'Воркеров', qntWorker);

      nextTest();
    } else {
      //console.log(`${iteration}: время загрузки`, (timeEndTest - timeStartTest) / 1000, 'с. Завершение', 'Воркеров', qntWorker);
      finInfo();
    }
  })
    .catch((error)=> {
      // Вывод ошибки
      console.warn('Были ошибки', error.message, error.options.har.url);
    });
}

function onceTest(testIteration) {
  //let timeStartTest = new Date();
  return new Promise(function (resolve, reject) {
    let promiseAllPages = []; // Все страницы одного теста
    pagesRequesLog.entries.forEach((page, i, arr) => {
      if ([301].indexOf(page.response.status) === -1 && // Пропускаем страницы% 301 - редирект
        requestedURL.indexOf(// Пропускаем страницы, не относящиеся к запрашиваемым сайтам.
          page.request.url.match(/^(ht|f)tp(s?):\/\/[0-9a-zA-Z]([-.\w]*[0-9a-zA-Z])/)[0] // База урл
            .replace(/^(ht|f)tp(s?):\/\//, '')) === 0) {// Сервер
        promiseAllPages.push(testPage(testIteration, page));
      }
    });

    Promise.all(promiseAllPages)
      .then((result) => {
        // let timeEndTest = new Date();
        // console.log(`${testIteration}: время загрузки`, (timeEndTest - timeStartTest) / 1000, 'с');
        resolve(result);
      })
      .catch(reject);
  });
}

function finInfo() {
  if (finalizeTest === virtUser * allTestIterations) {
    let reqBytes = sumTimeBytes(timeCheck[curTimeInterval]);
    console.log ('Финальное кол-во запросов', timeCheck[curTimeInterval].length, 'Кол-во ошибочных запросов', sumTime(timeErr[curTimeInterval]),
      'Размер Кбайт', Math.round(reqBytes / 1024), 'Кбайт/сек', Math.round (reqBytes / 1024 / 60));
    console.log('Среднее время загрузки страницы', (sumTime(timePage[curTimeInterval]) / timePage[curTimeInterval].length).toFixed(2),
      'Кол-во загруженных страниц', timePage[curTimeInterval].length);
    console.log('Выполнено сессий', finalizeTest);
  }
}

function testPage(testIteration, page) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      rp({resolveWithFullResponse: true, pool: {maxSockets: MAX_SOCKET}, timeout: WAIT_TIMEOUT,
          har: page.request})
        .then((response) => {
          if ([200, 304].indexOf(response.statusCode) !== -1) {
            setTimeRequest(bytesRespose(response));
            // Статус, адрес и байты запроса
            // console.log(response.statusCode, response.request.har.url, bytesRespose(response));
          } else {
            console.warn(response.statusCode, response.request.har.url);
          }
          resolve(response);
        })
        .catch((error) => {
          if (error.statusCode === 304) {
            // setTimeRequest(bytesRespose(error)); // TODO Не работает - нет respose.rawHeaders - может другой
            // Статус, адрес и байты запроса
            // console.log(response.statusCode, response.request.har.url, bytesRespose(response));
            resolve(error);
          } else {
            // console.warn(`${testIteration}:`, error.message, error.options.har.url);
            timeErr[curTimeInterval].push(1);
            resolve(error);
          }
        });
    }, Math.floor(Math.random() * MAX_RANDOM_WAIT));

  });
}

function bytesRespose(respose) {
  let sum = 0;
  respose.rawHeaders.forEach((item)=> {
    sum += item.length + 2; // 2 символа соединяют значения либо параметров, либо перенос строки
  });
  sum += respose.body.length;
  return sum;
}

function setTimeRequest(bytes) {
  checkTime(()=> {
    timeCheck[curTimeInterval].push({size: bytes});
  });
}

function sumTimeBytes(arr) {
  return arr.reduce((sum, current)=> {
    return sum + current.size;
  }, 0);
}

function sumTime(arr) {
  return arr.reduce((sum, current)=> {
    return sum + current;
  }, 0);
}

function checkTime(callback) {
  let now = new Date();
  let curTime = now.getHours() + ':' + now.getMinutes();
  if (!timeCheck[curTime]) {
    let prevTimeInterval = curTimeInterval;
    let reqBytes = sumTimeBytes(timeCheck[prevTimeInterval]);
    console.log (prevTimeInterval, 'Кол-во запроcов мин', timeCheck[prevTimeInterval].length,
      'Кол-во ошибочных запросов мин', sumTime(timeErr[prevTimeInterval]),
      'Запр/сек', Math.round(timeCheck[prevTimeInterval].length / 60),
      'Размер Кбайт',  Math.round(reqBytes / 1024), 'Кбайт/сек',  Math.round(reqBytes / 1024 / 60));
    console.log('Среднее время загрузки страницы', (sumTime(timePage[prevTimeInterval]) / timePage[curTimeInterval].length).toFixed(2),
      'Кол-во загруженных страниц', timePage[prevTimeInterval].length);
    timeCheck[curTime] = [];
    timeErr[curTime] = [];
    timeErr[curTime] = [];
    timePage[curTime] = [];
    curTimeInterval = curTime;
  }
  callback();
}
