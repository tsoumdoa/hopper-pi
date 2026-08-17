using System;

namespace rhino_zmq_poc
{
	internal sealed class CommandOperationException : Exception
	{
		public CommandOperationException(string message, string code = "operation_failed")
			: base(message)
		{
			Code = string.IsNullOrWhiteSpace(code) ? "operation_failed" : code;
		}

		public string Code { get; }

		public static string Fail(string message, string code = "operation_failed") =>
			throw new CommandOperationException(message, code);
	}
}
