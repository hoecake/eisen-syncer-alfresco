const validator = require("validator");
const _ = require("lodash");

module.exports = async (request, response, next) => {
  let errors = [];

  if (
    _.isNil(request.body.name) ||
    validator.isEmpty(request.body.name)
  ) {
    errors.push({
      name: ["Name field is mandatory"]
    });
  }

  if (
    _.isNil(request.body.value) ||
    validator.isEmpty(request.body.value)
  ) {
    errors.push({
        value: ["Value field is mandatory"]
    });
  }

  // Check if the error array has any data in it
  if (errors && errors.length > 0) {
    return response.status(400).json({
      errors: errors
    });
  }

  next();
};
