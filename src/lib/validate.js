export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const details = result.error.issues.map(({ path, message }) => ({
        field: path.join('.'),
        message,
      }));

      return res.status(422).json({
        error: {
          message: 'Validation failed',
          details,
        },
      });
    }

    req.body = result.data;
    return next();
  };
}
