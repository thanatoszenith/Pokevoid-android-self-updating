(function () {
  if (window.location.origin !== 'https://localhost' || window.PokeVoidSaves) return;
  var prompt = window.prompt.bind(window);
  function command(operation, key, value) {
    var result = prompt('PokeVoidSaves/v1', JSON.stringify({ operation: operation, key: key, value: value }));
    if (typeof result !== 'string') throw new Error('Direct external save bridge unavailable');
    return result;
  }
  Object.defineProperty(window, 'PokeVoidSaves', { value: Object.freeze({
    status: function () { return command('status'); },
    write: function (key, value) { return command('write', key, value); },
    remove: function (key) { return command('remove', key); }
  }) });
})();
