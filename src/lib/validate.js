export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);

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

    if (source === 'body') {
      req.body = result.data;
    } else {
      req.validated ??= {};
      req.validated[source] = result.data;
    }

    return next();
  };
}
