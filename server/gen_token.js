const jwt=require('jsonwebtoken'); console.log(jwt.sign({id:1,role:'admin'},'change-this-to-a-random-64-char-secret-string',{expiresIn:'7d'}));
