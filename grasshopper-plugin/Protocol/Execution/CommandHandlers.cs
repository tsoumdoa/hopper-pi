using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Text.Json;
using Grasshopper.Kernel;
using Rhino;

namespace rhino_zmq_poc.Protocol.Execution
{
    internal interface ICommandHandler
    {
        string Action { get; }
        ActionResult Execute(GH_Document ghDocument, RhinoDoc rhinoDocument, JsonElement parameters);
    }

    internal sealed class CommandHandlerRegistry
    {
        private readonly Dictionary<string, ICommandHandler> _handlers =
            new Dictionary<string, ICommandHandler>(StringComparer.Ordinal);

        public IReadOnlyCollection<string> KnownActions =>
            new ReadOnlyCollection<string>(_handlers.Keys.OrderBy(value => value, StringComparer.Ordinal).ToList());

        public void Register(ICommandHandler handler)
        {
            if (handler == null) throw new ArgumentNullException(nameof(handler));
            if (string.IsNullOrWhiteSpace(handler.Action))
                throw new ArgumentException("A command handler action is required.", nameof(handler));
            if (_handlers.ContainsKey(handler.Action))
                throw new InvalidOperationException($"A handler is already registered for '{handler.Action}'.");
            _handlers.Add(handler.Action, handler);
        }

        public bool TryGet(string action, out ICommandHandler handler) =>
            _handlers.TryGetValue(action ?? string.Empty, out handler);
    }

    internal sealed class DelegateCommandHandler : ICommandHandler
    {
        private readonly Func<GH_Document, RhinoDoc, JsonElement, ActionResult> _execute;

        public DelegateCommandHandler(
            string action,
            Func<GH_Document, RhinoDoc, JsonElement, ActionResult> execute)
        {
            Action = action ?? throw new ArgumentNullException(nameof(action));
            _execute = execute ?? throw new ArgumentNullException(nameof(execute));
        }

        public string Action { get; }

        public ActionResult Execute(GH_Document ghDocument, RhinoDoc rhinoDocument, JsonElement parameters) =>
            _execute(ghDocument, rhinoDocument, parameters);
    }

	/// <summary>Compatibility adapter for command actions with typed outcomes.</summary>
    internal sealed class LegacyCommandHandlerAdapter : ICommandHandler
    {
        private readonly CommandExecutor _executor;

        public LegacyCommandHandlerAdapter(string action, CommandExecutor executor)
        {
            Action = action ?? throw new ArgumentNullException(nameof(action));
            _executor = executor ?? throw new ArgumentNullException(nameof(executor));
        }

        public string Action { get; }

        public ActionResult Execute(GH_Document ghDocument, RhinoDoc rhinoDocument, JsonElement parameters)
        {
			return _executor.ExecuteStructured(ghDocument, rhinoDocument, new GhCommand
			{
				Action = Action,
				Params = parameters,
			});
		}
    }

    internal sealed class CommandBackendActionExecutor : IBackendActionExecutor
    {
        private readonly CommandHandlerRegistry _commands;
        private readonly Func<GH_Document, RhinoDoc, BackendAction, ActionResult> _nonCommandExecutor;

        public CommandBackendActionExecutor(
            CommandHandlerRegistry commands,
            Func<GH_Document, RhinoDoc, BackendAction, ActionResult> nonCommandExecutor = null)
        {
            _commands = commands ?? throw new ArgumentNullException(nameof(commands));
            _nonCommandExecutor = nonCommandExecutor;
        }

        public ActionResult Execute(GH_Document ghDocument, RhinoDoc rhinoDocument, BackendAction action)
        {
            if (action == null)
                return ActionResult.Failure("invalid_command", "A backend action is required.");
            if (action.Kind != "command")
            {
                return _nonCommandExecutor?.Invoke(ghDocument, rhinoDocument, action)
                    ?? ActionResult.Failure("invalid_command", $"No handler is registered for action kind '{action.Kind}'.");
            }
            if (action.Command == null || string.IsNullOrWhiteSpace(action.Command.Action))
                return ActionResult.Failure("invalid_command", "A command action is required.");
            if (!_commands.TryGet(action.Command.Action, out var handler))
                return ActionResult.Failure("invalid_command", $"Unknown command action '{action.Command.Action}'.");
            return handler.Execute(ghDocument, rhinoDocument, action.Command.Parameters);
        }
    }
}
