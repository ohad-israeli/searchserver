const
    argv = require('yargs')                         // yargs' is a command line parser
        .demandOption('credentials')                // complain if the '--credentials' argument isn't supplied
        .argv,
    express = require('express'),
    redis = require('redis'),                       // node_redis module
    credentials = require(argv.credentials),        // Our credentials are stored in a node_redis connection object - see https://github.com/NodeRedis/node_redis#rediscreateclient
    redisClient = redis.createClient(credentials),  // Client object for connection to the Redis server
    faker = require('faker'),                       // Faker will be used to generate data
    indexName = 'searchIndex',                         // the name of the search index that we will be created
    suggCompIndex = 'autoCompanyIndex',                 // auto complete index for company
    suggProdIndex = 'autoProductIndex'                  // auto complete index for product



const app = express();

const port = 5000;

// Print redis errors to the console
redisClient.on('error', (err) => {
    console.error(err);
}).on('connection', () => {
    console.log('Connected to Redis');
});

//Query data
function doSearch(req, res, next) {
    let query = req.query.search;
    let args = [
        indexName,
        query,
        'HIGHLIGHT'
    ];

    redisClient.send_command(
        'FT.SEARCH',
        args,
        function (err, resp) {
            if (err) {
                console.error(err);
                res.send(err.message);
            } else {
                // transform redis RESP to REST, read more about RESP https://redis.io/topics/protocol
                let result = [];
                resp.slice(1).map(function (record) {
                    if (Array.isArray(record)) {
                        let obj = {}
                        for (var i = 0; i < record.length; i += 2) {
                            obj[record[i]] = record[i + 1];
                        }
                        result.push(obj);
                    }
                });
                res.send(result);
            }
        });
};

//Query data
function doSuggest(req, res, next) {
    let suggest = req.query.suggest;
    let args = [
        suggProdIndex,
        suggest
    ];

    redisClient.send_command(
        'FT.SUGGET',
        args,
        function (err, resp) {
            if (err) {
                console.error(err);
                res.send(err.message);
            } else {
                let result = [];
                resp.map(function (record) {
                    let obj = {name: record}
                    result.push(obj);
                });
                res.send(result);
            }
        });
};

//Index data
function doIndex(req, res, next) {
    if(!req.query.numberOfDocs) {
        res.send('numberOfDocs param is missing');
        return;
    }
    // check if the index is found
    redisClient.send_command('FT.INFO', [indexName], function (err, info) {
        if (err) {
            // if the index does not exist then create it
            if (String(err).indexOf('Unknown Index name') > 0) {
                let args = [
                    indexName,
                    'SCHEMA', 'company', 'text', 'product', 'text', 'color', 'text', 'price', 'numeric'
                ];

                redisClient.send_command(
                    'FT.CREATE',
                    args,
                    function (err) {
                        if (err) {
                            console.error(err);
                        }
                    });
            }

        }

        // index some documents
        for (i = 0; i < req.query.numberOfDocs; i++) {
            indexDocument(i);
        }
        res.send('OK');
    });
}

function indexDocument(id) {
    const companyName = faker.company.companyName();
    const productName = faker.commerce.productName();

    let args = [
        indexName,
        id,
        1,          // default - this should be to be set in future versions
        'REPLACE',  // do an UPSERT style insertion
        'FIELDS', 'company', companyName, 'product', productName, 'color', faker.commerce.color(), 'price', faker.commerce.price()
    ];

    redisClient.send_command(
        'FT.ADD',
        args,
        function (err) {
            if (err) {
                console.error(err);
            }
        });

    args = [
        suggCompIndex,
        companyName,
        100
    ];

    redisClient.send_command(
        'FT.SUGADD',
        args,
        function (err) {
            if (err) {
                console.error(err);
            }
        });

    args = [
        suggProdIndex,
        productName,
        100
    ];

    redisClient.send_command(
        'FT.SUGADD',
        args,
        function (err) {
            if (err) {
                console.error(err);
            }
        });
}

app.set('port', process.env.port || port); // set express to use this port

// configure middleware
app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

app.get('/search', doSearch);

app.get('/suggest', doSuggest);

app.get('/index', doIndex);

app.listen(port, () => {
    console.log(`Server running on port: ${port}`);
});